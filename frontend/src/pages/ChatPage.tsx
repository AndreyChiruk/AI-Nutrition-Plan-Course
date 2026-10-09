import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import { chatApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import type { ChatMessage } from '../types';
import { formatApiError } from '../api/errors';

export const ChatPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
      const history = await chatApi.history(user.id);
      setMessages(history.slice().reverse());
    };
    void loadHistory();
  }, [user]);

  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !message.trim()) return;
    setSending(true);
    setError('');
    try {
      const result = await chatApi.sendMessage(user.id, message.trim());
      setMessages(result.history.slice().reverse());
      setMessage('');
    } catch (err) {
      setError(formatApiError(err, 'Не удалось отправить сообщение.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="profile-premium">
      <section className="card section-card stack">
        <div className="section-head">
          <MessageSquare size={18} />
          <h3>AI-чат ассистент</h3>
        </div>
        <p className="muted">
          Чат учитывает ваш профиль, цель и аллергии для более персональных советов.
        </p>

        <div className="chat-list">
          {sortedMessages.length === 0 ? (
            <p className="muted">История пуста. Задайте первый вопрос ассистенту.</p>
          ) : (
            sortedMessages.map((item) => (
              <div
                key={item.id}
                className={`chat-item ${item.role === 'assistant' ? 'assistant' : 'user'}`}
              >
                <strong>{item.role === 'assistant' ? 'Ассистент' : 'Вы'}:</strong>{' '}
                {item.content}
              </div>
            ))
          )}
        </div>

        <form onSubmit={onSubmit} className="stack-row">
          <input
            aria-label="Сообщение в чат"
            placeholder="Введите вопрос по питанию"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button type="submit" disabled={sending}>
            {sending ? 'Отправка...' : 'Отправить'}
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
};
