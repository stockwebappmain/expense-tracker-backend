import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { iconStyle } from './iconStyle';
import { newTransactionId } from './transaction';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const YES = /^(yes|yeah|yep|yup|sure|correct|right|save|save it|ok|okay|confirm|do it|go ahead|that'?s (right|correct)|sounds good)\b/i;
const NO = /^(no|nope|cancel|stop|never ?mind|don'?t|discard|forget it)\b/i;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d = new Date()) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmt2 = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Number(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const authHeaders = () => {
  let token = null;
  try { token = localStorage.getItem('auth_token'); } catch { /* storage unavailable */ }
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const SpeechRecognitionImpl = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export default function VoiceAssistant({ open, onClose, categories = [], onSaved }) {
  const [status, setStatus] = useState('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [proposal, setProposal] = useState(null);
  const [mode, setMode] = useState('Voice');
  const contextRef = useRef([]);
  const recognitionRef = useRef(null);
  const proposalRef = useRef(null);
  const modeRef = useRef(mode);

  useEffect(() => { proposalRef.current = proposal; }, [proposal]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const stopAll = useCallback(() => {
    try { recognitionRef.current && recognitionRef.current.abort(); } catch { /* already stopped */ }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  const reset = useCallback(() => {
    stopAll();
    contextRef.current = [];
    setStatus('idle'); setHeard(''); setReply(''); setProposal(null);
  }, [stopAll]);

  useEffect(() => { if (!open) reset(); }, [open, reset]);
  useEffect(() => () => stopAll(), [stopAll]);

  const speak = (text, after) => {
    setReply(text);
    if (modeRef.current !== 'Voice' || !window.speechSynthesis) { if (after) after(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.05;
    setStatus('speaking');
    u.onend = () => { if (after) after(); else setStatus('idle'); };
    u.onerror = () => setStatus('idle');
    window.speechSynthesis.speak(u);
  };

  const listen = () => {
    if (!SpeechRecognitionImpl) return;
    stopAll();
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (event) => {
      const text = Array.from(event.results).map(r => r[0].transcript).join(' ');
      setHeard(text);
      if (event.results[event.results.length - 1].isFinal) finalText = text;
    };
    rec.onerror = (event) => {
      setStatus('idle');
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setReply('Microphone access is blocked. Allow it for this site in your browser settings, then try again.');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setReply('Sorry, I couldn\'t hear that. Tap the mic and try again.');
      }
    };
    rec.onend = () => {
      if (finalText.trim()) handleUtterance(finalText.trim());
      else setStatus(s => (s === 'listening' ? 'idle' : s));
    };
    recognitionRef.current = rec;
    setHeard('');
    setStatus('listening');
    try { rec.start(); } catch { setStatus('idle'); }
  };

  const saveProposal = async (entries) => {
    setStatus('saving');
    try {
      const transactionId = newTransactionId();
      for (const e of entries) {
        await axios.post(`${API_URL}/api/expenses`, {
          ...e,
          transactionId,
          entryMethod: modeRef.current,
          createdAt: localStamp()
        }, { headers: authHeaders() });
      }
      setProposal(null);
      contextRef.current = [];
      if (onSaved) await onSaved();
      speak(entries.length > 1 ? `Saved all ${entries.length}.` : 'Saved.', () => setStatus('done'));
    } catch (err) {
      setStatus('idle');
      speak(err.response?.data?.error ? `I couldn't save that: ${err.response.data.error}` : 'I couldn\'t save that. Please try again.');
    }
  };

  const handleUtterance = async (text) => {
    setHeard(text);
    const pending = proposalRef.current;
    if (pending && YES.test(text)) return saveProposal(pending.entries);
    if (pending && NO.test(text)) {
      setProposal(null);
      contextRef.current = [];
      return speak('Okay, I didn\'t save it.', () => setStatus('idle'));
    }

    setStatus('thinking');
    try {
      const res = await axios.post(`${API_URL}/api/assistant`, {
        transcript: text,
        today: localDate(),
        context: contextRef.current
      }, { headers: authHeaders() });
      const data = res.data || {};
      contextRef.current = [...contextRef.current, { role: 'user', text }, { role: 'assistant', text: data.speech || '' }].slice(-6);

      if (data.kind === 'proposal') {
        setProposal({ entries: data.entries });
        speak(data.speech, () => listen());
      } else if (data.kind === 'clarify') {
        setProposal(null);
        speak(data.speech, () => listen());
      } else {
        setProposal(null);
        speak(data.speech || 'Sorry, I didn\'t catch that.');
      }
    } catch (err) {
      setStatus('idle');
      speak(err.response?.data?.error || 'Sorry, something went wrong. Please try again.');
    }
  };

  const tapMic = () => {
    setMode('Voice');
    modeRef.current = 'Voice';
    if (status === 'listening') { try { recognitionRef.current.stop(); } catch { /* already stopped */ } return; }
    listen();
  };

  if (!open) return null;
  const sheet = (name) => categories.find(c => c.name === name);
  const busy = status === 'thinking' || status === 'saving';

  return (
    <div className="va-backdrop" onClick={onClose}>
      <div className="va-sheet" role="dialog" aria-label="Expense assistant" onClick={e => e.stopPropagation()}>
        <div className="va-head">
          <span className="va-title">Expense assistant</span>
          <button className="va-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!heard && !reply && (
          <div className="va-hint">
            Tap the mic and say something like <b>"40 at Shell yesterday on my credit card"</b>, or ask <b>"How much did I spend on groceries this month?"</b>
          </div>
        )}
        {heard && <div className="va-heard">“{heard}”</div>}
        {reply && <div className="va-reply">{reply}</div>}

        {proposal && (
          <div className="va-proposal">
            {proposal.entries.map((e, i) => {
              const s = sheet(e.category);
              return (
                <div className="va-entry" key={i}>
                  <span className="xv-icon" style={iconStyle(s?.color)}>{s?.icon || '•'}</span>
                  <div className="cd-mid">
                    <div className="cd-merchant">{e.merchant || e.category}</div>
                    <div className="yv-muted">{[e.category, e.paymentMethod || 'payment not said', e.date].join(' · ')}</div>
                  </div>
                  <div className={`cd-amt ${e.amount < 0 ? 'va-refund' : ''}`}>{fmt2(e.amount)}</div>
                </div>
              );
            })}
            <div className="va-actions">
              <button className="va-btn ghost" onClick={() => handleUtterance('no')} disabled={busy}>Cancel</button>
              <button className="va-btn" onClick={() => saveProposal(proposal.entries)} disabled={busy}>Save</button>
            </div>
            <div className="yv-muted va-say">Or say "yes", "no", or a correction like "make it dining".</div>
          </div>
        )}

        <div className="va-controls">
          {SpeechRecognitionImpl && (
            <button className={`va-mic ${status}`} onClick={tapMic} disabled={busy} aria-label={status === 'listening' ? 'Stop listening' : 'Start listening'}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2c-2.2 0-4 1.8-4 4v7c0 2.2 1.8 4 4 4s4-1.8 4-4V6c0-2.2-1.8-4-4-4z" fill="currentColor"/>
                <path d="M4 12a8 8 0 0 0 16 0"/><path d="M12 20v2"/>
              </svg>
            </button>
          )}
          <div className="va-status">
            {status === 'listening' && 'Listening…'}
            {status === 'thinking' && 'Thinking…'}
            {status === 'speaking' && 'Speaking…'}
            {status === 'saving' && 'Saving…'}
          </div>
          {!SpeechRecognitionImpl && (
            <div className="va-hint">Voice isn't supported in this browser. Try Safari on iPhone or Chrome, or use the + button to add an expense by hand.</div>
          )}
        </div>
      </div>
    </div>
  );
}
