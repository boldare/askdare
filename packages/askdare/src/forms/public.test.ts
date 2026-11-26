import { describe, expect, it } from 'vitest';
import { defineForm } from './define-form';
import { publicForm } from './public';

const contact = defineForm({
  name: 'contact',
  description: 'SERVER ONLY: show when the visitor wants an offer.',
  title: { en: 'Get an offer', pl: 'Zapytaj o ofertę', 'de-AT': 'Angebot' },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: { en: 'Name', pl: 'Imię' },
      placeholder: { en: 'Anna', pl: 'Anna' },
      required: true,
      maxLength: 80,
    },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'phone', label: 'Phone' },
    {
      name: 'topic',
      type: 'select',
      label: 'Topic',
      options: [
        { value: 'pricing', label: { en: 'Pricing', pl: 'Cennik' } },
        { value: 'demo', label: 'Demo' },
      ],
      toModel: true,
    },
    { name: 'message', type: 'textarea', label: 'Message' },
    { name: 'consent', type: 'consent', label: { pl: 'Zgoda', en: 'Consent' }, required: true },
  ],
  submit: { en: 'Send', pl: 'Wyślij' },
  done: 'Thanks!',
});

describe('publicForm', () => {
  it('describes every field in English', () => {
    expect(publicForm(contact, 'en')).toEqual({
      name: 'contact',
      title: 'Get an offer',
      fields: [
        {
          name: 'name',
          type: 'text',
          label: 'Name',
          required: true,
          placeholder: 'Anna',
          maxLength: 80,
        },
        { name: 'email', type: 'email', label: 'Email', required: true, maxLength: 254 },
        { name: 'phone', type: 'phone', label: 'Phone', required: false, maxLength: 20 },
        {
          name: 'topic',
          type: 'select',
          label: 'Topic',
          required: false,
          options: [
            { value: 'pricing', label: 'Pricing' },
            { value: 'demo', label: 'Demo' },
          ],
        },
        { name: 'message', type: 'textarea', label: 'Message', required: false, maxLength: 2000 },
        { name: 'consent', type: 'consent', label: 'Consent', required: true },
      ],
      submit: 'Send',
      done: 'Thanks!',
    });
  });

  it('never carries what is for the server only', () => {
    const json = JSON.stringify(publicForm(contact, 'en'));
    expect(json).not.toContain('SERVER ONLY');
    expect(json).not.toContain('toModel');
    expect(json).not.toContain('description');
    expect(json).not.toContain('"model"');
  });

  it('resolves texts for the visitor language', () => {
    const polish = publicForm(contact, 'pl');
    expect(polish.title).toBe('Zapytaj o ofertę');
    expect(polish.fields[0]?.label).toBe('Imię');
    expect(polish.fields[3]?.options?.[0]?.label).toBe('Cennik');
    expect(polish.fields[5]?.label).toBe('Zgoda');
    expect(polish.submit).toBe('Wyślij');
    // A plain string is the same in every language.
    expect(polish.done).toBe('Thanks!');
  });

  it('matches a region to its language, and a language to a region', () => {
    expect(publicForm(contact, 'pl-PL').title).toBe('Zapytaj o ofertę');
    expect(publicForm(contact, 'de').title).toBe('Angebot');
    expect(publicForm(contact, 'DE-at').title).toBe('Angebot');
  });

  it('falls back to English, then to the first text given', () => {
    expect(publicForm(contact, 'fr').title).toBe('Get an offer');
    expect(publicForm(contact, 'not a tag').title).toBe('Get an offer');
    const noEnglish = defineForm({
      name: 'x',
      model: false,
      title: { pl: 'Tytuł', de: 'Titel' },
      fields: [{ name: 'a', type: 'text', label: { 'en-GB': 'Colour', pl: 'Kolor' } }],
    });
    expect(publicForm(noEnglish, 'fr').title).toBe('Tytuł');
    expect(publicForm(noEnglish, 'fr').fields[0]?.label).toBe('Colour');
  });

  it('leaves submit and done to the chat when the form sets none', () => {
    const plain = defineForm({
      name: 'x',
      model: false,
      title: 'T',
      fields: [{ name: 'a', type: 'consent', label: 'A' }],
    });
    expect(publicForm(plain, 'en')).toEqual({
      name: 'x',
      title: 'T',
      fields: [{ name: 'a', type: 'consent', label: 'A', required: false }],
    });
  });
});
