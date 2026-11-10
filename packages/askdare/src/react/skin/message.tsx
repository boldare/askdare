import { Citations, Message, MessageFiles, MessageText, useMessage } from '@boldare/askdare/react';
import type { ReactElement } from 'react';
import { Avatar } from './avatar';

/** One message: the assistant's face beside its answers, then text, files and sources. */
export function DefaultMessage(): ReactElement {
  const message = useMessage();
  return (
    <Message>
      {message.role === 'assistant' && <Avatar size="small" />}
      <div data-ask-part="message-body">
        <MessageText />
        <MessageFiles />
        <Citations />
      </div>
    </Message>
  );
}
