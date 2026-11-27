import { defineForm } from '@boldare/askdare';

/*
 * The demo's forms (ADR-0031). The model shows `contact` when a visitor wants an offer; `handoff`
 * collects contact details for "Talk to a person" (ADR-0030) and is never offered to the model.
 * Their values go to the route's onLead and onHandoff: askdare stores none of them.
 */

/** A sales lead: the model shows it when a visitor wants an offer, a demo or a call. */
export const contactForm = defineForm({
  name: 'contact',
  description:
    'Contact details for a sales follow-up. Show it when the visitor wants an offer, a demo or a call from the sales team.',
  title: { en: 'Get an offer', pl: 'Zapytaj o ofertę' },
  fields: [
    { name: 'name', type: 'text', label: { en: 'Name', pl: 'Imię' }, required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'phone', label: { en: 'Phone', pl: 'Telefon' } },
    {
      name: 'topic',
      type: 'select',
      label: { en: 'Topic', pl: 'Temat' },
      options: [
        { value: 'pricing', label: { en: 'Pricing', pl: 'Cennik' } },
        { value: 'demo', label: { en: 'A demo', pl: 'Prezentacja' } },
        {
          value: 'migration',
          label: { en: 'Moving from another tool', pl: 'Przejście z innego narzędzia' },
        },
      ],
      // The bot can go on helping with the topic; it never sees the contact details.
      toModel: true,
    },
    {
      name: 'consent',
      type: 'consent',
      label: {
        en: 'Brightloop may contact me about my request.',
        pl: 'Brightloop może się ze mną skontaktować w sprawie zapytania.',
      },
      required: true,
    },
  ],
  submit: { en: 'Send', pl: 'Wyślij' },
  done: {
    en: 'Thanks! Brightloop’s sales team will write to you. (This is a demo: nobody will.)',
    pl: 'Dziękujemy! Zespół Brightloop napisze do Ciebie. (To demo: nikt nie napisze).',
  },
});

/** Contact details for a person from the team, and a message to leave when nobody is there. */
export const handoffForm = defineForm({
  name: 'handoff',
  model: false,
  title: { en: 'Talk to a person', pl: 'Rozmowa z człowiekiem' },
  fields: [
    { name: 'name', type: 'text', label: { en: 'Name', pl: 'Imię' }, required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    {
      name: 'message',
      type: 'textarea',
      label: { en: 'How can we help?', pl: 'W czym możemy pomóc?' },
      maxLength: 1000,
    },
  ],
  submit: { en: 'Send', pl: 'Wyślij' },
});
