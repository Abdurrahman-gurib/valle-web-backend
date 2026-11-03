/** "Rs 12,500": how every message, receipt and audit entry writes rupees. */
export const rupees = (n: number): string => 'Rs ' + n.toLocaleString('en-US');

/** "2 adults and 1 child" / "1 adult · 2 children": the party as messages spell it out. */
export const partyText = (adults: number, kids: number, joiner: string): string =>
  `${adults} adult${adults === 1 ? '' : 's'}` + (kids ? `${joiner}${kids} child${kids === 1 ? '' : 'ren'}` : '');
