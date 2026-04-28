import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AdminChatBubbleProps {
  shop: string;
}

export function AdminChatBubble({ shop }: AdminChatBubbleProps) {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "👋 Hi! I'm your loyalty app assistant. Ask me anything about setting up points, tiers, redemptions, or any feature.",
    },
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [unread, setUnread]     = useState(false);
  const messagesEndRef           = useRef<HTMLDivElement>(null);
  const inputRef                 = useRef<HTMLInputElement>(null);
  const historyRef               = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  // Show unread dot after 4s if bubble is closed
  useEffect(() => {
    const t = setTimeout(() => { if (!open) setUnread(true); }, 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (open) {
      setUnread(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/admin-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          message: text,
          history: historyRef.current.slice(-10),
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "Sorry, something went wrong.";
      const aiMsg: Message = { role: "assistant", content: reply };
      setMessages((prev) => [...prev, aiMsg]);
      historyRef.current.push({ role: "user", content: text });
      historyRef.current.push({ role: "assistant", content: reply });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please check your connection." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <>
      {/* ── Styles ─────────────────────────────────────────────────────── */}
      <style>{`
        .acb-root {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .acb-trigger {
          width: 56px; height: 56px; border-radius: 50%;
          background: #008060; border: none; cursor: pointer;
          box-shadow: 0 4px 20px rgba(0,0,0,.25);
          display: flex; align-items: center; justify-content: center;
          color: #fff; transition: transform .2s, box-shadow .2s;
          position: relative;
        }
        .acb-trigger:hover { transform: scale(1.08); box-shadow: 0 6px 26px rgba(0,0,0,.3); }
        .acb-dot {
          position: absolute; top: -2px; right: -2px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #ef4444; border: 2px solid #fff;
        }
        .acb-panel {
          position: absolute; bottom: 68px; right: 0;
          width: 340px; max-height: 480px;
          background: #fff; border-radius: 14px;
          box-shadow: 0 8px 40px rgba(0,0,0,.18);
          display: flex; flex-direction: column;
          overflow: hidden;
          animation: acbSlide .18s ease;
        }
        @keyframes acbSlide {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .acb-header {
          background: #008060; padding: 12px 14px;
          display: flex; align-items: center; justify-content: space-between;
          color: #fff;
        }
        .acb-header-left { display: flex; align-items: center; gap: 10px; }
        .acb-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(255,255,255,.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 17px;
        }
        .acb-title { font-size: 13px; font-weight: 700; }
        .acb-sub   { font-size: 11px; opacity: .8; margin-top: 1px; }
        .acb-close {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,.85); font-size: 17px;
          padding: 2px 6px; border-radius: 4px;
          line-height: 1; transition: background .15s;
        }
        .acb-close:hover { background: rgba(255,255,255,.15); }
        .acb-messages {
          flex: 1; overflow-y: auto; padding: 12px 10px;
          display: flex; flex-direction: column; gap: 8px;
          background: #f9fafb;
        }
        .acb-msg {
          max-width: 88%; padding: 8px 11px;
          border-radius: 12px; font-size: 13px; line-height: 1.5;
          word-break: break-word;
        }
        .acb-msg-ai   { background: #fff; color: #111; border: 1px solid #e5e7eb; border-radius: 12px 12px 12px 2px; align-self: flex-start; }
        .acb-msg-user { background: #008060; color: #fff; border-radius: 12px 12px 2px 12px; align-self: flex-end; }
        .acb-typing {
          display: flex; gap: 4px; align-items: center;
          padding: 9px 11px; background: #fff;
          border: 1px solid #e5e7eb; border-radius: 12px 12px 12px 2px;
          align-self: flex-start;
        }
        .acb-typing span {
          width: 7px; height: 7px; border-radius: 50%;
          background: #9ca3af;
          animation: acbDot 1.2s infinite ease-in-out;
          display: inline-block;
        }
        .acb-typing span:nth-child(2) { animation-delay: .2s; }
        .acb-typing span:nth-child(3) { animation-delay: .4s; }
        @keyframes acbDot {
          0%, 80%, 100% { transform: scale(.7); opacity: .5; }
          40%            { transform: scale(1);  opacity: 1;  }
        }
        .acb-input-row {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 10px; border-top: 1px solid #e5e7eb;
          background: #fff;
        }
        .acb-input {
          flex: 1; border: 1px solid #d1d5db; border-radius: 18px;
          padding: 7px 13px; font-size: 13px; outline: none;
          transition: border-color .15s;
        }
        .acb-input:focus { border-color: #008060; }
        .acb-send {
          width: 34px; height: 34px; border-radius: 50%;
          background: #008060; border: none; cursor: pointer; color: #fff;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: opacity .15s;
        }
        .acb-send:disabled { opacity: .45; cursor: not-allowed; }
      `}</style>

      {/* ── Root ────────────────────────────────────────────────────────── */}
      <div className="acb-root">
        {/* Panel */}
        {open && (
          <div className="acb-panel">
            {/* Header */}
            <div className="acb-header">
              <div className="acb-header-left">
                <div className="acb-avatar">🤖</div>
                <div>
                  <div className="acb-title">App Assistant</div>
                  <div className="acb-sub">Ask me anything</div>
                </div>
              </div>
              <button className="acb-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {/* Messages */}
            <div className="acb-messages">
              {messages.map((m, i) => (
                <div key={i} className={`acb-msg ${m.role === "user" ? "acb-msg-user" : "acb-msg-ai"}`}>
                  {m.content}
                </div>
              ))}
              {loading && (
                <div className="acb-typing">
                  <span /><span /><span />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="acb-input-row">
              <input
                ref={inputRef}
                className="acb-input"
                type="text"
                placeholder="Ask about the app…"
                maxLength={400}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                autoComplete="off"
              />
              <button className="acb-send" disabled={loading || !input.trim()} onClick={send} aria-label="Send">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Trigger button */}
        <button
          className="acb-trigger"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open app assistant"
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
          {!open && unread && <span className="acb-dot" />}
        </button>
      </div>
    </>
  );
}
