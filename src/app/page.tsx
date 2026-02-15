'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialogueInput } from '@/types';

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const arrayBuffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

type PodcastStyle = 'short' | 'medium' | 'long';

const STYLE_OPTIONS: { value: PodcastStyle; label: string; desc: string }[] = [
  { value: 'short', label: 'Court', desc: '3-5 min — essentiel' },
  { value: 'medium', label: 'Moyen', desc: '10-15 min — pédagogique' },
  { value: 'long', label: 'Long', desc: '30-35 min — approfondi' },
];

export default function Home() {
  const [url, setUrl] = useState('https://openai.com/index/introducing-gpt-5/');
  const [podcastStyle, setPodcastStyle] = useState<PodcastStyle>('short');

  // Step states
  const [isScraping, setIsScraping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  // Data
  const [scrapedContent, setScrapedContent] = useState<{ content: string; title: string } | null>(null);
  const [conversation, setConversation] = useState<Array<{ speaker: string; text: string }> | null>(null);
  const [isConversationComplete, setIsConversationComplete] = useState(false);
  const [conversationTurns, setConversationTurns] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // UI
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const prevTurnsRef = useRef(0);
  const [newStartIndex, setNewStartIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const voices = useMemo(() => [
    { id: 'RILOU7YmBhvwJGDGjNmP', name: 'Sophie' },
    { id: 'NNl6r8mD7vthiJatiJt1', name: 'Marc' },
  ], []);

  // Step 1: Scrape
  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsScraping(true);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Échec de l\'extraction');
      }

      setScrapedContent(await res.json());
    } catch (error) {
      alert(`Erreur : ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsScraping(false);
    }
  };

  // Step 2: Generate conversation
  const handleGenerateConversation = async () => {
    if (!scrapedContent) return;

    setIsGenerating(true);
    setConversation(null);
    setIsConversationComplete(false);
    setConversationTurns(0);
    setAudioUrl(null);
    prevTurnsRef.current = 0;

    try {
      const res = await fetch('/api/generate-podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: scrapedContent.content,
          title: scrapedContent.title,
          style: podcastStyle,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Échec de la génération');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('Pas de flux disponible');

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const update = JSON.parse(line);
              if (update.type === 'partial' && update.data?.conversation) {
                setConversation(update.data.conversation);
                setConversationTurns(Array.isArray(update.data.conversation) ? update.data.conversation.length : 0);
              } else if (update.type === 'complete' && update.data?.conversation) {
                setConversation(update.data.conversation);
                setIsConversationComplete(true);
                setConversationTurns(Array.isArray(update.data.conversation) ? update.data.conversation.length : 0);
              } else if (update.type === 'error') {
                throw new Error(update.error || 'Erreur de streaming');
              }
            } catch (parseError) {
              console.error('Erreur de parsing:', parseError);
            }
          }
        }
      }
    } catch (error) {
      alert(`Erreur : ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Step 3: Generate audio
  const handleGenerateAudio = useCallback(async () => {
    if (!conversation || conversation.length === 0) return;

    setIsGeneratingAudio(true);

    try {
      const dialogueInputs: DialogueInput[] = conversation.map((item) => ({
        text: item.text,
        voiceId: item.speaker === 'Speaker1' ? voices[0].id : voices[1].id,
      }));

      const res = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: dialogueInputs }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Échec de la synthèse audio');
      }

      const data = await res.json();

      if (audioUrl) {
        try { URL.revokeObjectURL(audioUrl); } catch {}
      }

      setAudioUrl(data.audioBase64);
    } catch (error) {
      alert(`Erreur : ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsGeneratingAudio(false);
    }
  }, [conversation, voices, audioUrl]);

  // Edit conversation turn
  const updateTurnText = (index: number, newText: string) => {
    if (!conversation) return;
    const updated = [...conversation];
    updated[index] = { ...updated[index], text: newText };
    setConversation(updated);
    setAudioUrl(null); // Invalidate audio when text changes
  };

  const getSpeakerName = (speaker: string) => {
    return speaker === 'Speaker1' ? voices[0].name : voices[1].name;
  };

  // Track new streamed items for animation
  useEffect(() => {
    if (conversationTurns > prevTurnsRef.current) {
      setNewStartIndex(prevTurnsRef.current);
      prevTurnsRef.current = conversationTurns;
    } else if (conversationTurns < prevTurnsRef.current) {
      prevTurnsRef.current = conversationTurns;
      setNewStartIndex(0);
    }
  }, [conversationTurns]);

  // Avatar
  const Avatar = ({ name, tone }: { name: string; tone: 'left' | 'right' }) => {
    const initial = (name || '?').slice(0, 1).toUpperCase();
    const gradId = `grad-${tone}`;
    const g1 = tone === 'left' ? '#8b5cf6' : '#06b6d4';
    const g2 = tone === 'left' ? '#ec4899' : '#22c55e';
    return (
      <svg viewBox="0 0 40 40" className="h-8 w-8 rounded-full shadow-md">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={g1} />
            <stop offset="100%" stopColor={g2} />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill={`url(#${gradId})`} opacity="0.9" />
        <text x="50%" y="54%" textAnchor="middle" fontSize="18" fontWeight="700" fill="white" fontFamily="system-ui, -apple-system, Segoe UI, Roboto">{initial}</text>
      </svg>
    );
  };

  // Audio controls
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setIsPlaying(false);
    try { el.pause(); } catch {}
    el.currentTime = 0;
    el.playbackRate = 1.15;
    try { el.load(); } catch {}
  }, [audioUrl]);

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    try {
      if (el.paused) {
        await el.play();
        setIsPlaying(true);
      } else {
        el.pause();
        setIsPlaying(false);
      }
    } catch (e) {
      console.error('Audio play/pause error', e);
    }
  };

  const restartAudio = () => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    try {
      el.currentTime = 0;
      if (!el.paused) el.play();
    } catch (e) {
      console.error('Audio restart error', e);
    }
  };

  // Download helpers
  const downloadAs = useCallback(async (format: 'mp3' | 'wav') => {
    if (!audioUrl) return;

    // Extract base64 data
    const base64Data = audioUrl.replace(/^data:audio\/\w+;base64,/, '');
    const rawBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    let blob: Blob;
    if (format === 'mp3') {
      blob = new Blob([rawBytes], { type: 'audio/mpeg' });
    } else {
      // Convert raw PCM/MP3 bytes to WAV wrapper
      const audioCtx = new AudioContext();
      const arrayBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const wavBlob = audioBufferToWav(audioBuffer);
      blob = wavBlob;
      audioCtx.close();
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `podcast-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [audioUrl]);

  // Character count
  const totalChars = useMemo(() => {
    if (!conversation) return 0;
    return conversation.reduce((sum, item) => sum + (item.text?.length ?? 0), 0);
  }, [conversation]);

  // Progress steps
  type StepStatus = 'pending' | 'in_progress' | 'complete';
  const steps = useMemo(() => {
    const hasScraped = !!scrapedContent;
    const hasConversation = !!conversation && conversation.length > 0;
    const convoDone = isConversationComplete;
    const hasAudio = !!audioUrl;

    const scrapeStatus: StepStatus = isScraping ? 'in_progress' : hasScraped ? 'complete' : 'pending';
    const convoStatus: StepStatus = isGenerating ? 'in_progress' : convoDone ? 'complete' : hasConversation ? 'in_progress' : 'pending';
    const audioStatus: StepStatus = isGeneratingAudio ? 'in_progress' : hasAudio ? 'complete' : 'pending';

    return [
      { key: 'scrape', label: 'Extraction', status: scrapeStatus },
      { key: 'conversation', label: 'Dialogue', status: convoStatus },
      { key: 'audio', label: 'Audio', status: audioStatus },
    ];
  }, [scrapedContent, conversation, isConversationComplete, isGeneratingAudio, audioUrl, isScraping, isGenerating]);

  return (
    <div className="relative font-sans min-h-screen p-6 lg:p-8 overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-950 dark:to-black">
      {/* Glows */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-gradient-to-br from-fuchsia-500/25 to-indigo-500/25 blur-3xl glow-pulse" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-cyan-400/20 to-emerald-500/20 blur-3xl glow-pulse" />

      <div className="relative max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold text-center mb-6 text-gray-900 dark:text-white">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500">Générateur de Podcast IA</span>
        </h1>

        {/* Progress bar */}
        <div className="mb-6 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-lg p-4">
          <div className="grid grid-cols-3 gap-2">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                {s.status === 'complete' && <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />}
                {s.status === 'in_progress' && <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />}
                {s.status === 'pending' && <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />}
                <span className={`text-xs ${s.status === 'in_progress' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                  {i + 1}. {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Three-column workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Left: Source + Style */}
          <div className="lg:col-span-3 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-lg p-4 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">1. Source</h2>
            <form onSubmit={handleScrape} className="space-y-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white/70 dark:bg-white/10 border border-white/40 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 text-sm"
                placeholder="https://example.com/article"
                disabled={isScraping}
                required
              />
              <button
                type="submit"
                disabled={isScraping || !url.trim()}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-2 px-4 rounded-md font-medium hover:from-blue-500 hover:to-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-md text-sm"
              >
                {isScraping && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />}
                {isScraping ? 'Extraction…' : 'Extraire le contenu'}
              </button>
            </form>

            {/* Content preview */}
            {scrapedContent && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Contenu extrait</h3>
                <div className="bg-white/60 dark:bg-white/5 p-3 rounded border border-white/40 dark:border-white/10 backdrop-blur">
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-1 truncate">
                    {scrapedContent.title}
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-4">
                    {scrapedContent.content.substring(0, 400)}…
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{scrapedContent.content.length} caractères</p>
                </div>
              </div>
            )}

            {/* Style selector */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Style du podcast</h3>
              <div className="space-y-2">
                {STYLE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2 p-2 rounded-md cursor-pointer border transition-colors ${
                      podcastStyle === opt.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="radio"
                      name="podcastStyle"
                      value={opt.value}
                      checked={podcastStyle === opt.value}
                      onChange={(e) => setPodcastStyle(e.target.value as PodcastStyle)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Middle: Conversation */}
          <div className="lg:col-span-6 rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-lg p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">2. Dialogue</h2>
              <div className="flex items-center gap-2">
                {conversation && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {conversationTurns} échanges · {totalChars} car.
                  </span>
                )}
                {isGenerating && <span className="text-xs text-blue-600 dark:text-blue-400">En cours…</span>}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerateConversation}
              disabled={!scrapedContent || isGenerating}
              className="mb-3 w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white py-2 px-4 rounded-md font-medium hover:from-fuchsia-500 hover:to-purple-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-md text-sm"
            >
              {isGenerating && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />}
              {isGenerating ? `Génération… (${conversationTurns} échanges)` : 'Générer le dialogue'}
            </button>

            {/* Conversation display */}
            <div className="bg-white/40 dark:bg-white/5 rounded p-4 space-y-3 flex-1 min-h-[240px] max-h-[520px] overflow-y-auto border border-white/30 dark:border-white/10 backdrop-blur">
              {conversation && conversation.length > 0 ? (
                conversation.map((item, index) => {
                  const left = item.speaker === 'Speaker1';
                  const isNew = index >= newStartIndex;
                  const isEditing = editingIndex === index;
                  return (
                    <div key={index} className={`flex gap-3 ${left ? 'justify-start' : 'justify-end'}`}>
                      {left && <div className="mt-0.5"><Avatar name={getSpeakerName(item.speaker)} tone="left" /></div>}
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-md border backdrop-blur-md transition-all ${isNew && !isEditing ? 'animate-fade-in-up' : ''} ${left ? 'bg-white/80 border-white/50 text-gray-900' : 'bg-blue-600/90 border-white/30 text-white'}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className={`text-xs ${left ? 'text-blue-700' : 'text-white/80'}`}>{getSpeakerName(item.speaker)}</div>
                          {isConversationComplete && !isGenerating && (
                            <button
                              onClick={() => setEditingIndex(isEditing ? null : index)}
                              className={`text-xs opacity-60 hover:opacity-100 transition-opacity ${left ? 'text-gray-500' : 'text-white/70'}`}
                              title={isEditing ? 'Fermer' : 'Modifier'}
                            >
                              {isEditing ? '✓' : '✎'}
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <textarea
                            value={item.text}
                            onChange={(e) => updateTurnText(index, e.target.value)}
                            className={`w-full text-sm leading-relaxed bg-transparent border-0 outline-none resize-y min-h-[60px] ${left ? 'text-gray-900' : 'text-white placeholder:text-white/50'}`}
                            rows={3}
                          />
                        ) : (
                          <div className="text-sm leading-relaxed whitespace-pre-wrap">{item.text ?? ''}</div>
                        )}
                      </div>
                      {!left && <div className="mt-0.5"><Avatar name={getSpeakerName(item.speaker)} tone="right" /></div>}
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {scrapedContent
                    ? 'Contenu prêt. Sélectionnez un style et générez le dialogue.'
                    : 'Extrayez d\'abord le contenu d\'une URL.'}
                </div>
              )}
            </div>
          </div>

          {/* Right: Audio */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">3. Audio</h2>

              {/* Generate audio button */}
              <button
                onClick={handleGenerateAudio}
                disabled={!conversation || conversation.length === 0 || isGeneratingAudio || isGenerating}
                className="w-full mb-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white py-2 px-4 rounded-md font-medium hover:from-emerald-500 hover:to-teal-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-md text-sm"
              >
                {isGeneratingAudio && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />}
                {isGeneratingAudio ? 'Synthèse en cours…' : 'Générer l\'audio'}
              </button>

              {audioUrl ? (
                <div className="flex items-center justify-center gap-3 py-2">
                  <button
                    onClick={togglePlay}
                    className="relative inline-flex items-center justify-center h-16 w-16 rounded-full text-white shadow-xl transition transform hover:scale-[1.03] active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 bg-gradient-to-br from-indigo-600 to-fuchsia-600"
                    aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                  >
                    {!isPlaying && <span className="absolute inset-0 rounded-full bg-indigo-500/30 blur-md pulse-ring" aria-hidden />}
                    <span className="relative text-2xl leading-none">{isPlaying ? '❚❚' : '▶'}</span>
                  </button>
                  <button
                    onClick={restartAudio}
                    className="inline-flex items-center justify-center h-12 w-12 rounded-full text-white bg-gradient-to-br from-gray-600 to-gray-700 shadow-lg transition transform hover:scale-[1.03] active:scale-95"
                    aria-label="Restart audio"
                  >
                    <span className="text-lg leading-none">↻</span>
                  </button>
                  <audio
                    ref={audioRef}
                    src={audioUrl || undefined}
                    preload="metadata"
                    className="hidden"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                  />
                  {/* Download buttons */}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => downloadAs('mp3')}
                      className="flex-1 bg-gradient-to-r from-gray-700 to-gray-800 text-white py-1.5 px-3 rounded-md text-xs font-medium hover:from-gray-600 hover:to-gray-700 transition-colors shadow"
                    >
                      MP3
                    </button>
                    <button
                      onClick={() => downloadAs('wav')}
                      className="flex-1 bg-gradient-to-r from-gray-700 to-gray-800 text-white py-1.5 px-3 rounded-md text-xs font-medium hover:from-gray-600 hover:to-gray-700 transition-colors shadow"
                    >
                      WAV
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full h-24 bg-white/40 dark:bg-white/5 border border-white/30 dark:border-white/10 rounded flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 backdrop-blur">
                  {isGeneratingAudio ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
                      <span>Synthèse en cours…</span>
                    </div>
                  ) : (
                    <span>Pas encore d&apos;audio.</span>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Voix</h3>
              <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                <div>
                  <span className="font-medium text-blue-600 dark:text-blue-400">Speaker 1:</span> {voices[0].name}
                </div>
                <div>
                  <span className="font-medium text-blue-600 dark:text-blue-400">Speaker 2:</span> {voices[1].name}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
