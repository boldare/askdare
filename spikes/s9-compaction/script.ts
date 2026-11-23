/**
 * A 50-message support conversation (askdare's default `limits.maxTurns`), written to be long but
 * realistic: most messages ask about a policy (a search), some mention an order (a lookup), some
 * are short follow-ups. The visitor states facts early that the recall probes ask about later.
 */
export const SCRIPT: readonly string[] = [
  'Hi! I am Ola. I live in Krakow, postcode 31-415, on the 5th floor. I want to buy a sofa - how long does delivery take?',
  'Will the couriers carry it up to my floor? Our lift is broken.',
  'How much would that cost for the 5th floor exactly?',
  'Can you check my order 48213? I ordered a dining table last week.',
  'When exactly will it arrive and who is the carrier?',
  'What is the warranty on sofa upholstery? I have two cats.',
  'And does the warranty cover the frame too?',
  'OK. Which payment methods do you accept?',
  'Can I pay in instalments?',
  'Do you offer an assembly service and what does it cost?',
  'If I book assembly for the sofa and the table together, how much is that?',
  'Thanks. What is your returns policy?',
  'Does that also apply to mattresses?',
  'I might need to change my order 48213 - can I still add chair pads?',
  'How do I get an invoice for my company?',
  'Can the invoice have my company tax number added after purchase?',
  'Do you price match if I find the same sofa cheaper elsewhere?',
  'What about the loyalty points - how many do I get per order?',
  'Can I use loyalty points together with a gift card?',
  'Do gift cards expire?',
  'Another question: I also have order 55102, a rug. Where is it?',
  'It says delayed? Why would it be delayed?',
  'What happens if an item arrives damaged?',
  'How long do I have to report damage?',
  'Can I cancel just the rug and keep the rest?',
  'How long until I get the refund for a cancellation?',
  'And if I paid by card, is it faster?',
  'Do you have click and collect in Krakow?',
  'What are the store hours of the Krakow showroom?',
  'Can I return an online order in the showroom?',
  'Do you sell custom-size furniture?',
  'How long does custom furniture take to make?',
  'Can custom orders be cancelled?',
  'Do you recycle old furniture when you deliver the new sofa?',
  'Is there a fee for taking away the old sofa?',
  'How should I clean a linen sofa?',
  'Are your rugs suitable for underfloor heating?',
  'I am a student, is there a student discount?',
  'Can I combine the student discount with price matching?',
  'What if the sofa I want is out of stock?',
  'Can I pre-order it then? When would I pay?',
  'Do you ship to Germany? My sister lives in Berlin.',
  'What does international shipping cost?',
  'Is installation available for wall-mounted shelves?',
  'Do you have accessibility support for customers with disabilities?',
  'Can a support agent call me instead of chatting?',
  'Do you offer bulk discounts if my office buys 20 chairs?',
  'How do I change the delivery address of order 48213?',
  'Perfect, thank you. Can you summarise what I need to do next?',
  'Thanks, that is all for today!',
];

/**
 * Probes asked after the compaction point, in every arm. `expect` is checked case-insensitively
 * against the answer; `cite` names the planted passage the answer should cite.
 */
export const PROBES: readonly { id: string; text: string; expect: readonly RegExp[]; cite?: 'upholstery' | 'doorway' | 'returnWindow' | 'assembly' }[] = [
  { id: 'visitor-facts', text: 'Quick check before I go: what is my name, my postcode, and which floor do I live on? One line.', expect: [/ola/i, /31-415/, /5(th)?\b|fifth/i] },
  { id: 'tool-fact', text: 'Which carrier is delivering order 48213, and what was its tracking code? Answer from what you told me earlier, do not look it up again.', expect: [/DHL|DPD|InPost/, /NWT-\d+/] },
  { id: 'cited-earlier', text: 'Remind me how many years the sofa upholstery warranty was - and cite the source you used earlier.', expect: [/\b7\b|seven/i], cite: 'upholstery' },
  { id: 'cited-earlier-2', text: 'And what did you say the per-floor carrying charge above the third floor was? Cite it.', expect: [/39/], cite: 'doorway' },
  { id: 'small', text: 'Great, thanks a lot!', expect: [] },
];
