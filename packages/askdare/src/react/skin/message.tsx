import {
  Citations,
  Message,
  MessageFiles,
  MessageText,
  QuickReplies,
  useMessage,
} from '@boldare/askdare/react';
import type { ReactElement } from 'react';
import { Avatar } from './avatar';
import { Feedback } from './feedback';

/**
 * One message: the assistant's face beside its answers, then text, files, sources, rating and,
 * under the latest answer, the options the visitor can click.
 */
export function DefaultMessage(): ReactElement {
  const message = useMessage();
  return (
    <Message>
      {message.role === 'assistant' && <Avatar size="small" />}
      <div data-ask-part="message-body">
        <MessageText />
        <MessageFiles />
        <Citations />
        <Feedback />
        <QuickReplies />
      </div>
    </Message>
  );
}
