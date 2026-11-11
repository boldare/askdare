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
import { useSkin } from './context';
import { Feedback } from './feedback';

/**
 * One message: the assistant's face beside its answers, then text, files, sources, rating and,
 * under the latest answer, the options the visitor can click (unless the theme puts them above
 * the message field).
 */
export function DefaultMessage(): ReactElement {
  const message = useMessage();
  const { variants } = useSkin().bot;
  return (
    <Message>
      {message.role === 'assistant' && <Avatar size="small" />}
      <div data-ask-part="message-body">
        <MessageText />
        <MessageFiles />
        <Citations />
        <Feedback />
        {variants.replies === 'answer' && <QuickReplies />}
      </div>
    </Message>
  );
}
