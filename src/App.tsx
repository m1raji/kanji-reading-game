import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, XCircle, Trophy, Play, Settings, X } from 'lucide-react';

type WordType = '音' | '訓' | '例外';

interface Word {
  word: string;
  reading: string;
  meaning: string;
  type: WordType;
}

type GameState = 'input' | 'loading' | 'playing' | 'showing_answer' | 'finished';

interface AppSettings {
  baseUrl: string;
  model: string;
  apiKeys: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKeys: []
};

const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    window.speechSynthesis.speak(utterance);
  }
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>('input');
  const [kanji, setKanji] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [wordStats, setWordStats] = useState<Record<string, number>>({});
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [lastWord, setLastWord] = useState<string | null>(null);
  const [bonusTime, setBonusTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(7);
  const [error, setError] = useState('');
  const [showReading, setShowReading] = useState(false);
  
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('kanji_game_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [keyIndex, setKeyIndex] = useState(0);
  const [tempKeysText, setTempKeysText] = useState(settings.apiKeys.join('\n'));
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startGame = async () => {
    const inputKanji = kanji.trim();
    if (!inputKanji) return;
    if (!/[\u4e00-\u9faf]/.test(inputKanji)) {
      setError('請輸入一個有效的漢字。');
      return;
    }

    if (settings.apiKeys.length === 0) {
      setError('請先在設定中填入 API Key。');
      return;
    }

    setGameState('loading');
    setError('');
    
    try {
      const currentKey = settings.apiKeys[keyIndex % settings.apiKeys.length];
      setKeyIndex(prev => prev + 1);

      const prompt = `請生成 8 到 16 個包含漢字「${inputKanji}」的日文單字。
每個單字必須包含：
1. word: 單字本身（包含該漢字）
2. reading: 假名讀音
3. meaning: 繁體中文意思
4. type: 該漢字在這個單字中的讀音類型，必須是「音」、「訓」或「例外」其中之一。
請只回傳 JSON 陣列格式，不要包含其他文字或 Markdown 標記。`;

      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API 請求失敗 (${response.status})`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content.trim();
      
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsedData = JSON.parse(content);
      if (!Array.isArray(parsedData) || parsedData.length < 8) {
        throw new Error('生成的單字數量不足或格式錯誤，請換一個漢字試試。');
      }
      
      setWords(parsedData);
      const initialStats: Record<string, number> = {};
      parsedData.forEach((w: Word) => { initialStats[w.word] = 0; });
      setWordStats(initialStats);
      setBonusTime(0);
      setLastWord(null);
      setShowReading(false);
      
      const next = parsedData[Math.floor(Math.random() * parsedData.length)];
      setCurrentWord(next);
      setGameState('playing');

    } catch (err: any) {
      console.error(err);
      setError(err.message || '生成失敗，請重試。');
      setGameState('input');
    }
  };

  const pickNextWord = (currentStats: Record<string, number>) => {
    setShowReading(false);
    const available = words.filter(w => (currentStats[w.word] || 0) < 2);
    if (available.length === 0) {
      setGameState('finished');
      return;
    }
    let candidates = available.filter(w => w.word !== lastWord);
    if (candidates.length === 0) candidates = available;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    setCurrentWord(next);
    setGameState('playing');
  };

  useEffect(() => {
    if (gameState === 'playing' && currentWord) {
      const startTime = Date.now();
      const timeLimit = 7 + bonusTime;
      setTimeLeft(timeLimit);

      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(0, timeLimit - elapsed);
        setTimeLeft(remaining);

        if (remaining === 0) {
          handleTimeout();
        }
      }, 50);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [gameState, currentWord, bonusTime]);

  const handleTimeout = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!currentWord || showReading) return;
    
    speak(currentWord.reading);

    const newStats = { ...wordStats, [currentWord.word]: 0 };
    setWordStats(newStats);
    setBonusTime(0);
    setLastWord(currentWord.word);
    setGameState('showing_answer');
  };

  const handleAnswer = (selectedType: WordType) => {
    if (gameState !== 'playing' || !currentWord || showReading) return;
    if (timerRef.current) clearInterval(timerRef.current);

    speak(currentWord.reading);

    const timeLimit = 7 + bonusTime;
    const timeSpent = timeLimit - timeLeft;
    const isCorrect = selectedType === currentWord.type;

    if (isCorrect) {
      setShowReading(true);
      const newStats = { ...wordStats, [currentWord.word]: (wordStats[currentWord.word] || 0) + 1 };
      setWordStats(newStats);
      
      const newBonus = timeSpent <= 2 ? 3 : 0;
      setBonusTime(newBonus);
      setLastWord(currentWord.word);

      setTimeout(() => {
        pickNextWord(newStats);
      }, 1500);
    } else {
      const newStats = { ...wordStats, [currentWord.word]: 0 };
      setWordStats(newStats);
      setBonusTime(0);
      setLastWord(currentWord.word);
      setGameState('showing_answer');
    }
  };

  useEffect(() => {
    if (gameState === 'showing_answer') {
      const timer = setTimeout(() => {
        pickNextWord(wordStats);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [gameState]);

  const skipAnswer = () => {
    if (gameState === 'showing_answer') {
      pickNextWord(wordStats);
    }
  };

  const learnedCount = words.filter(w => (wordStats[w.word] || 0) >= 2).length;
  const totalWords = words.length;

  return (
    <div className="min-h-screen bg-[#F8F3E1] text-[#41431B] flex flex-col items-center justify-center p-4 font-sans">
      <AnimatePresence mode="wait">
        {gameState === 'input' && (
          <motion.div 
            key="input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-[#E3DBBB] p-8 rounded-3xl shadow-xl max-w-md w-full text-center border-2 border-[#AEB784] relative"
          >
            <button 
              onClick={() => setShowSettings(true)}
              className="absolute top-6 right-6 text-[#41431B] hover:opacity-70 transition-opacity"
            >
              <Settings size={24} />
            </button>
            <h1 className="text-4xl font-black mb-2 tracking-tight">音訓讀練習</h1>
            <p className="text-[#41431B] opacity-80 mb-8 font-medium">輸入一個漢字來開始遊戲</p>
            
            <input 
              type="text" 
              maxLength={1}
              value={kanji}
              onChange={e => setKanji(e.target.value)}
              className="w-32 h-32 text-7xl text-center border-4 border-[#AEB784] rounded-2xl bg-[#F8F3E1] focus:outline-none focus:border-[#41431B] focus:ring-4 focus:ring-[#AEB784]/30 transition-all mb-8 shadow-inner"
              placeholder="漢"
            />
            
            <button 
              onClick={startGame}
              disabled={!kanji.trim()}
              className="w-full py-4 bg-[#41431B] text-[#F8F3E1] text-xl font-bold rounded-2xl hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md active:scale-95"
            >
              <Play size={24} fill="currentColor" /> 開始遊戲
            </button>
            
            {error && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-600 mt-4 font-bold bg-red-100 py-2 px-4 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {gameState === 'loading' && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="w-16 h-16 border-8 border-[#E3DBBB] border-t-[#41431B] rounded-full animate-spin"></div>
            <div className="text-2xl font-bold text-[#41431B] animate-pulse">
              正在生成「{kanji}」的題目...
            </div>
          </motion.div>
        )}

        {gameState === 'playing' && currentWord && (
          <motion.div 
            key="playing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md"
          >
            <div className="flex justify-between items-end mb-2 font-bold px-1">
              <div className="flex items-center gap-2 text-xl">
                <Clock size={24} /> 
                <span className={timeLeft <= 2 ? 'text-red-600 animate-pulse' : ''}>
                  {timeLeft.toFixed(1)}s
                </span>
              </div>
              <div className="text-right">
                {bonusTime > 0 && (
                  <motion.div 
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-[#AEB784] text-sm bg-[#41431B] px-2 py-1 rounded-md mb-1 inline-block"
                  >
                    +3s 獎勵!
                  </motion.div>
                )}
                <div className="text-sm opacity-70">進度: {learnedCount} / {totalWords}</div>
              </div>
            </div>
            
            <div className="w-full h-4 bg-[#E3DBBB] rounded-full mb-8 overflow-hidden shadow-inner">
              <div 
                className={`h-full transition-all duration-75 ease-linear ${timeLeft <= 2 ? 'bg-red-500' : 'bg-[#AEB784]'}`}
                style={{ width: `${(timeLeft / (7 + bonusTime)) * 100}%` }}
              />
            </div>

            <motion.div 
              key={currentWord.word}
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="bg-[#E3DBBB] p-12 rounded-[2rem] shadow-xl text-center mb-8 border-2 border-[#AEB784]/30 flex flex-col items-center justify-center min-h-[240px]"
            >
              <h2 className="text-7xl font-black tracking-widest">{currentWord.word}</h2>
              {showReading && (
                <motion.p 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-3xl text-[#AEB784] font-bold mt-4 bg-[#41431B] inline-block px-6 py-2 rounded-xl"
                >
                  {currentWord.reading}
                </motion.p>
              )}
              <div className="mt-6 flex gap-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-4 h-4 rounded-full ${i < (wordStats[currentWord.word] || 0) ? 'bg-[#AEB784]' : 'bg-[#F8F3E1] border-2 border-[#AEB784]'}`}
                  />
                ))}
              </div>
            </motion.div>

            <div className="grid grid-cols-3 gap-4">
              {(['音', '訓', '例外'] as WordType[]).map(type => (
                <button
                  key={type}
                  onClick={() => handleAnswer(type)}
                  className="py-6 bg-[#41431B] text-[#F8F3E1] text-2xl font-bold rounded-2xl hover:bg-opacity-90 transition-all active:scale-95 shadow-md border-b-4 border-black/20 active:border-b-0 active:translate-y-1"
                >
                  {type}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {gameState === 'showing_answer' && currentWord && (
          <motion.div 
            key="answer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#41431B]/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer z-50"
            onClick={skipAnswer}
          >
            <motion.div 
              initial={{ y: 50, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              className="bg-[#F8F3E1] p-10 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl border-4 border-[#E3DBBB]"
            >
              <div className="text-red-500 font-black text-2xl mb-6 flex items-center justify-center gap-2">
                <XCircle size={32} /> 答錯或超時！
              </div>
              <h2 className="text-6xl font-black mb-4">{currentWord.word}</h2>
              <p className="text-3xl text-[#AEB784] font-bold mb-4 bg-[#41431B] inline-block px-6 py-2 rounded-xl">{currentWord.reading}</p>
              <p className="text-xl mb-8 font-medium text-[#41431B]/80">{currentWord.meaning}</p>
              
              <div className="inline-block px-8 py-3 bg-[#E3DBBB] rounded-2xl text-2xl font-black border-4 border-[#41431B] shadow-[4px_4px_0px_0px_#41431B]">
                正確答案: {currentWord.type}
              </div>
              
              <p className="text-sm mt-10 opacity-60 font-bold animate-bounce">點擊畫面繼續...</p>
            </motion.div>
          </motion.div>
        )}

        {gameState === 'finished' && (
          <motion.div 
            key="finished"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#E3DBBB] p-10 rounded-[2.5rem] shadow-2xl max-w-md w-full text-center border-4 border-[#AEB784]"
          >
            <Trophy size={80} className="mx-auto text-[#AEB784] mb-6" />
            <h2 className="text-5xl font-black mb-4 text-[#41431B]">恭喜完成！</h2>
            <p className="text-xl mb-10 font-medium text-[#41431B]/80">
              你已經熟練掌握了「<span className="text-3xl font-bold text-[#41431B]">{kanji}</span>」的讀音！
            </p>
            <button 
              onClick={() => {
                setKanji('');
                setGameState('input');
              }}
              className="w-full py-4 bg-[#AEB784] text-[#41431B] font-black text-2xl rounded-2xl hover:bg-opacity-90 transition-all active:scale-95 shadow-[0_4px_0_0_#41431B] active:shadow-none active:translate-y-1"
            >
              再玩一次
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {showSettings && (
        <div className="fixed inset-0 bg-[#41431B]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#F8F3E1] p-6 rounded-3xl max-w-md w-full shadow-2xl border-4 border-[#E3DBBB] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-[#41431B]">LLM 設定</h2>
              <button onClick={() => setShowSettings(false)} className="text-[#41431B] hover:opacity-70">
                <X size={24} />
              </button>
            </div>
            
            <div className="space-y-4 text-left">
              <div>
                <label className="block text-sm font-bold mb-1">Base URL</label>
                <input 
                  type="text" 
                  value={settings.baseUrl}
                  onChange={e => setSettings({...settings, baseUrl: e.target.value})}
                  className="w-full p-2 border-2 border-[#AEB784] rounded-xl bg-white focus:outline-none focus:border-[#41431B]"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold mb-1">Model</label>
                <input 
                  type="text" 
                  value={settings.model}
                  onChange={e => setSettings({...settings, model: e.target.value})}
                  className="w-full p-2 border-2 border-[#AEB784] rounded-xl bg-white focus:outline-none focus:border-[#41431B]"
                  placeholder="gpt-4o-mini"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold mb-1">API Keys (一行一個，自動輪替)</label>
                <textarea 
                  value={tempKeysText}
                  onChange={e => {
                    setTempKeysText(e.target.value);
                    setSettings({
                      ...settings, 
                      apiKeys: e.target.value.split('\n').map(k => k.trim()).filter(k => k)
                    });
                  }}
                  className="w-full p-2 border-2 border-[#AEB784] rounded-xl bg-white focus:outline-none focus:border-[#41431B] h-32 font-mono text-sm"
                  placeholder="sk-..."
                />
                <p className="text-xs opacity-70 mt-1">目前已設定 {settings.apiKeys.length} 組 Key</p>
              </div>
              
              <button 
                onClick={() => {
                  localStorage.setItem('kanji_game_settings', JSON.stringify(settings));
                  setShowSettings(false);
                }}
                className="w-full py-3 mt-4 bg-[#41431B] text-[#F8F3E1] font-bold rounded-xl hover:bg-opacity-90 transition-all active:scale-95"
              >
                儲存設定
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
