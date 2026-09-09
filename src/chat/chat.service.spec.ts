import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ChatConversation, ChatMessage, StaffUser } from '../entities';
import { ChatService } from './chat.service';

const CONV_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const VISITOR = 'v-abc12345';

const conversation = (
  over: Partial<ChatConversation> = {},
): ChatConversation =>
  ({
    id: CONV_ID,
    visitorKey: VISITOR,
    visitorName: '',
    visitorEmail: '',
    subject: '',
    status: 'open',
    assignedTo: null,
    unreadStaff: 0,
    unreadVisitor: 0,
    lastMessageAt: new Date('2026-08-01T10:00:00.000Z'),
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    ...over,
  }) as ChatConversation;

interface Mocks {
  convRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  messageRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  staffRepo: { find: jest.Mock };
}

function build(): { service: ChatService } & Mocks {
  const convRepo = {
    findOne: jest.fn(),
    create: jest.fn((v: Partial<ChatConversation>) => v),
    save: jest.fn((v: Partial<ChatConversation>) =>
      Promise.resolve(conversation(v)),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const messageRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((v: Partial<ChatMessage>) => v),
    save: jest.fn((v: Partial<ChatMessage>) =>
      Promise.resolve({
        id: 'msg-1',
        createdAt: new Date('2026-08-02T12:00:00.000Z'),
        staffUserId: null,
        ...v,
      } as ChatMessage),
    ),
  };
  const staffRepo = {
    find: jest.fn().mockResolvedValue([{ id: STAFF_ID, name: 'Ana' }]),
  };

  const service = new ChatService(
    convRepo as unknown as Repository<ChatConversation>,
    messageRepo as unknown as Repository<ChatMessage>,
    staffRepo as unknown as Repository<StaffUser>,
  );
  return { service, convRepo, messageRepo, staffRepo };
}

/** `update()` writes raw SQL for the counters, so resolve it for assertions. */
const setValue = (patch: Record<string, unknown>, key: string): unknown => {
  const value = patch[key];
  return typeof value === 'function'
    ? (value as () => string)()
    : value;
};

describe('ChatService.startSession', () => {
  it('reuses the visitor’s open conversation', async () => {
    const { service, convRepo, messageRepo } = build();
    const open = conversation({ unreadStaff: 2 });
    convRepo.findOne.mockResolvedValue(open);
    messageRepo.find.mockResolvedValue([
      {
        id: 'msg-0',
        conversationId: CONV_ID,
        sender: 'visitor',
        staffUserId: null,
        body: 'hello',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      } as ChatMessage,
    ]);

    const result = await service.startSession(VISITOR);

    expect(convRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { visitorKey: VISITOR, status: 'open' },
      }),
    );
    expect(convRepo.save).not.toHaveBeenCalled();
    expect(result.conversation).toBe(open);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].createdAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('creates a new conversation when the previous one is closed', async () => {
    const { service, convRepo } = build();
    // The lookup filters on status 'open', so a closed thread is never found.
    convRepo.findOne.mockResolvedValue(null);

    const result = await service.startSession(VISITOR, ' Ana ', 'a@b.com');

    expect(convRepo.save).toHaveBeenCalledTimes(1);
    expect(convRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        visitorKey: VISITOR,
        visitorName: 'Ana',
        visitorEmail: 'a@b.com',
      }),
    );
    expect(result.conversation.status).toBe('open');
    expect(result.messages).toEqual([]);
  });
});

describe('ChatService.assertVisitorOwns', () => {
  it('throws Forbidden for a foreign visitorKey', async () => {
    const { service, convRepo } = build();
    convRepo.findOne.mockResolvedValue(conversation({ visitorKey: 'v-other01' }));

    await expect(service.assertVisitorOwns(CONV_ID, VISITOR)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFound when the conversation is gone', async () => {
    const { service, convRepo } = build();
    convRepo.findOne.mockResolvedValue(null);

    await expect(service.assertVisitorOwns(OTHER_ID, VISITOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFound for a malformed id instead of hitting the database', async () => {
    const { service, convRepo } = build();

    await expect(service.assertVisitorOwns('not-a-uuid', VISITOR)).rejects.toThrow(
      NotFoundException,
    );
    expect(convRepo.findOne).not.toHaveBeenCalled();
  });

  it('returns the conversation for its owner', async () => {
    const { service, convRepo } = build();
    const own = conversation();
    convRepo.findOne.mockResolvedValue(own);

    await expect(service.assertVisitorOwns(CONV_ID, VISITOR)).resolves.toBe(own);
  });
});

describe('ChatService.addVisitorMessage', () => {
  it('bumps unread_staff and last_message_at', async () => {
    const { service, convRepo, messageRepo } = build();
    convRepo.findOne.mockResolvedValue(conversation());

    const { message } = await service.addVisitorMessage(
      CONV_ID,
      VISITOR,
      'is the zipline open?',
    );

    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        sender: 'visitor',
        staffUserId: null,
        body: 'is the zipline open?',
      }),
    );
    const [where, patch] = convRepo.update.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(where).toEqual({ id: CONV_ID });
    expect(setValue(patch, 'unreadStaff')).toBe('unread_staff + 1');
    expect(setValue(patch, 'lastMessageAt')).toEqual(
      new Date('2026-08-02T12:00:00.000Z'),
    );
    expect(message.sender).toBe('visitor');
    expect(message.staffName).toBeUndefined();
  });

  it('refuses to write into someone else’s conversation', async () => {
    const { service, convRepo, messageRepo } = build();
    convRepo.findOne.mockResolvedValue(conversation({ visitorKey: 'v-other01' }));

    await expect(
      service.addVisitorMessage(CONV_ID, VISITOR, 'hi'),
    ).rejects.toThrow(ForbiddenException);
    expect(messageRepo.save).not.toHaveBeenCalled();
  });
});

describe('ChatService.addStaffMessage', () => {
  it('resets unread_staff and resolves the operator name', async () => {
    const { service, convRepo } = build();
    convRepo.findOne.mockResolvedValue(conversation({ unreadStaff: 4 }));

    const { message } = await service.addStaffMessage(
      CONV_ID,
      STAFF_ID,
      'Yes, 9am to 5pm.',
    );

    const patch = convRepo.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.unreadStaff).toBe(0);
    expect(setValue(patch, 'unreadVisitor')).toBe('unread_visitor + 1');
    expect(message.sender).toBe('staff');
    expect(message.staffName).toBe('Ana');
  });
});
