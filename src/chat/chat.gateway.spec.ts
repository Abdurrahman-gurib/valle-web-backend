import { Logger } from '@nestjs/common';
import { ChatConversation } from '../entities';
import { StaffAuthService } from '../staff/auth/staff-auth.service';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { ChatGateway } from './chat.gateway';
import { ChatService, Msg } from './chat.service';

const CONV_ID = '11111111-1111-4111-8111-111111111111';

const AGENT: StaffPrincipal = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'agent@vallepark.com',
  name: 'Ana',
  role: 'agent',
};

const conversation = {
  id: CONV_ID,
  visitorName: 'Confidential Guest',
  visitorEmail: 'private.guest@example.com',
} as ChatConversation;

const message: Msg = {
  id: 'msg-1',
  conversationId: CONV_ID,
  sender: 'visitor',
  body: 'my card number is 4111 1111 1111 1111',
  createdAt: '2026-08-02T12:00:00.000Z',
};

/** Stands in for one socket sitting in the staff room. */
interface FakeSocket {
  id: string;
  handshake: { headers: { cookie?: string } };
  data: { staff?: StaffPrincipal };
  disconnect: jest.Mock;
}

const socketFor = (id: string, staff: StaffPrincipal = AGENT): FakeSocket => ({
  id,
  handshake: { headers: { cookie: `valle_staff=token-${id}` } },
  data: { staff },
  disconnect: jest.fn(),
});

function build(sockets: FakeSocket[]) {
  const emit = jest.fn();
  // `.to(a).to(b).emit(...)` has to keep returning the same chain object.
  const chain: { to: jest.Mock; emit: jest.Mock } = { to: jest.fn(), emit };
  chain.to.mockReturnValue(chain);

  const fetchSockets = jest.fn().mockResolvedValue(sockets);
  const server = {
    in: jest.fn().mockReturnValue({ fetchSockets }),
    to: jest.fn().mockReturnValue(chain),
  };

  const staffFromCookieHeader = jest.fn().mockResolvedValue(AGENT);
  const chat = {
    toSummary: jest.fn().mockReturnValue({ id: CONV_ID }),
  };

  const gateway = new ChatGateway(
    chat as unknown as ChatService,
    { staffFromCookieHeader } as unknown as StaffAuthService,
  );
  // The decorator normally injects this; unit tests wire it by hand.
  (gateway as unknown as { server: unknown }).server = server;

  return { gateway, server, emit, staffFromCookieHeader, fetchSockets };
}

/** Every payload the emit chain was handed, flattened. */
const emitted = (emit: jest.Mock): unknown[] =>
  emit.mock.calls.map((call) => call[1]);

describe('ChatGateway staff-room revocation', () => {
  // Eviction is a logged event by design; the log itself is not under test.
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('disconnects a deactivated operator instead of broadcasting to them', async () => {
    const stale = socketFor('sock-stale');
    const { gateway, emit, staffFromCookieHeader } = build([stale]);
    // The account row is gone or `active = false`, so no principal resolves.
    staffFromCookieHeader.mockResolvedValue(null);

    await gateway.announceVisitorMessage(conversation, message);

    expect(staffFromCookieHeader).toHaveBeenCalledWith(
      'valle_staff=token-sock-stale',
    );
    expect(stale.disconnect).toHaveBeenCalledWith(true);
    expect(stale.data.staff).toBeUndefined();
    // The fan-out itself still runs, for whoever is left.
    expect(emitted(emit).length).toBeGreaterThan(0);
  });

  it('disconnects an operator demoted out of the chat roles', async () => {
    const demoted = socketFor('sock-hr');
    const { gateway, staffFromCookieHeader } = build([demoted]);
    // Still a valid session, just not one allowed near visitor conversations.
    staffFromCookieHeader.mockResolvedValue({ ...AGENT, role: 'hr' });

    await gateway.announceVisitorMessage(conversation, message);

    expect(demoted.disconnect).toHaveBeenCalledWith(true);
    expect(demoted.data.staff).toBeUndefined();
  });

  it('drops the socket on every staff-room fan-out, not only messages', async () => {
    const demoted = socketFor('sock-hr');
    const { gateway, staffFromCookieHeader } = build([demoted]);
    staffFromCookieHeader.mockResolvedValue({ ...AGENT, role: 'hr' });

    await gateway.announceConversation(conversation);

    expect(demoted.disconnect).toHaveBeenCalledWith(true);
  });

  it('drops a socket whose re-check throws rather than trusting it', async () => {
    const stale = socketFor('sock-db-down');
    const { gateway, staffFromCookieHeader } = build([stale]);
    staffFromCookieHeader.mockRejectedValue(new Error('database is down'));

    await gateway.announceStaffMessage(conversation, message);

    expect(stale.disconnect).toHaveBeenCalledWith(true);
  });

  it('keeps an operator who still qualifies', async () => {
    const live = socketFor('sock-live');
    const { gateway, emit } = build([live]);

    await gateway.announceVisitorMessage(conversation, message);

    expect(live.disconnect).not.toHaveBeenCalled();
    expect(emitted(emit)).toContainEqual({
      conversationId: CONV_ID,
      message,
    });
  });

  it('memoises the lookup so a busy room is not one query per message', async () => {
    const live = socketFor('sock-live');
    const { gateway, staffFromCookieHeader } = build([live]);

    await gateway.announceVisitorMessage(conversation, message);
    await gateway.announceVisitorMessage(conversation, message);
    await gateway.announceConversation(conversation);

    // Four fan-outs inside the TTL window, one database round trip.
    expect(staffFromCookieHeader).toHaveBeenCalledTimes(1);
  });

  it('re-checks once the memo TTL has expired', async () => {
    const live = socketFor('sock-live');
    const { gateway, staffFromCookieHeader } = build([live]);
    const realNow = Date.now;
    let clock = 1_000_000;
    Date.now = () => clock;

    try {
      await gateway.announceConversation(conversation);
      clock += 10_000; // past the recheck TTL
      staffFromCookieHeader.mockResolvedValue(null);
      await gateway.announceConversation(conversation);
    } finally {
      Date.now = realNow;
    }

    expect(staffFromCookieHeader).toHaveBeenCalledTimes(2);
    expect(live.disconnect).toHaveBeenCalledWith(true);
  });

  it('evicts only the revoked socket, not the whole room', async () => {
    const good = socketFor('sock-good');
    const bad = socketFor('sock-bad');
    const { gateway, staffFromCookieHeader } = build([good, bad]);
    staffFromCookieHeader.mockImplementation((cookie: string) =>
      Promise.resolve(cookie.endsWith('sock-bad') ? null : AGENT),
    );

    await gateway.announceVisitorMessage(conversation, message);

    expect(bad.disconnect).toHaveBeenCalledWith(true);
    expect(good.disconnect).not.toHaveBeenCalled();
    expect(good.data.staff).toEqual(AGENT);
  });

  it('is a no-op without a websocket server (REST-only unit tests)', async () => {
    const { gateway } = build([]);
    (gateway as unknown as { server: unknown }).server = undefined;

    await expect(
      gateway.announceVisitorMessage(conversation, message),
    ).resolves.toBeUndefined();
    await expect(
      gateway.announceConversation(conversation),
    ).resolves.toBeUndefined();
  });
});
