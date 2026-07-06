import { useTranslation } from 'react-i18next';

type BotReplyPreviewProps = {
  botReply: string;
};

export default function BotReplyPreview({ botReply }: BotReplyPreviewProps) {
  const { t } = useTranslation();

  return (
    <section style={{
      maxWidth: 960,
      marginBottom: '1rem',
      padding: '0.75rem 1rem',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: '0.88rem',
      whiteSpace: 'pre-wrap',
    }}
    >
      <strong>{t('intentPlayground.whatsappPreview')}</strong>
      <div style={{ marginTop: '0.5rem', color: '#475569' }}>{botReply}</div>
    </section>
  );
}
