export const SUPPORT_INTRO_TEXT =
  'Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen. Je krijgt binnen 3 werkdagen reactie.';

const LEGACY_SUPPORT_INTRO_TEXT =
  'Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen totdat wij reageren. We reageren binnen 3 werkdagen.';

export const SUPPORT_INTRO_TEXTS = [SUPPORT_INTRO_TEXT, LEGACY_SUPPORT_INTRO_TEXT];

export const normalizeSupportMessage = (message, thread) => {
  if (!message) return null;
  if (message.senderRole) {
    return {
      ...message,
      senderRole: message.senderRole,
      senderUid: message.senderRole === 'system'
        ? null
        : message.senderUid ?? message.senderId ?? null,
    };
  }

  const text = message.text || message.message || '';
  const senderUid = message.senderUid ?? message.senderId ?? null;
  if (SUPPORT_INTRO_TEXTS.includes(text)) {
    return {
      ...message,
      senderRole: 'system',
      senderUid: null,
    };
  }

  if (thread?.userUid && senderUid === thread.userUid) {
    return {
      ...message,
      senderRole: 'user',
      senderUid,
    };
  }

  return {
    ...message,
    senderRole: 'moderator',
    senderUid,
  };
};
