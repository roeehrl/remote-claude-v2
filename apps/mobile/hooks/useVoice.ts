import { useState, useCallback, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

// ============================================================================
// Types
// ============================================================================

export interface UseVoiceOptions {
  /** Language for speech recognition and TTS (default: 'en-US') */
  language?: string;
  /** Enable interim results during speech recognition */
  interimResults?: boolean;
  /** TTS speech rate (default: 1.0) */
  speechRate?: number;
  /** TTS pitch (default: 1.0) */
  speechPitch?: number;
  /** Callback when speech recognition produces a final result */
  onSpeechResult?: (transcript: string) => void;
  /** Callback when TTS finishes speaking */
  onSpeechDone?: () => void;
}

export interface UseVoiceReturn {
  // Speech Recognition
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  cancelListening: () => void;
  speechRecognitionAvailable: boolean;
  speechRecognitionError: string | null;

  // Text-to-Speech
  isSpeaking: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const {
    language = 'en-US',
    interimResults = true,
    speechRate = 1.0,
    speechPitch = 1.0,
    onSpeechResult,
    onSpeechDone,
  } = options;

  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState(false);
  const [speechRecognitionError, setSpeechRecognitionError] = useState<string | null>(null);

  // Text-to-Speech State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // Track if we should call onSpeechResult (to avoid duplicate calls)
  const hasCalledResultRef = useRef(false);

  // ============================================================================
  // Check Speech Recognition Availability
  // ============================================================================

  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
        setSpeechRecognitionAvailable(available);
      } catch (error) {
        console.warn('[Voice] Speech recognition not available:', error);
        setSpeechRecognitionAvailable(false);
      }
    };
    checkAvailability();
  }, []);

  // ============================================================================
  // Speech Recognition Events
  // ============================================================================

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
    setSpeechRecognitionError(null);
    hasCalledResultRef.current = false;
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('result', (event: { results: Array<{ transcript: string; isFinal?: boolean }> }) => {
    const result = event.results[0];
    if (result) {
      if (result.isFinal) {
        setTranscript(result.transcript);
        setInterimTranscript('');
        if (!hasCalledResultRef.current && result.transcript.trim()) {
          hasCalledResultRef.current = true;
          onSpeechResult?.(result.transcript.trim());
        }
      } else {
        setInterimTranscript(result.transcript);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event: { error: string; message?: string }) => {
    console.warn('[Voice] Speech recognition error:', event.error, event.message);
    setSpeechRecognitionError(event.message || event.error);
    setIsListening(false);
  });

  // ============================================================================
  // Speech Recognition Controls
  // ============================================================================

  const startListening = useCallback(async () => {
    if (isListening) return;

    try {
      // Request permissions
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        setSpeechRecognitionError('Microphone permission denied');
        return;
      }

      // Clear previous state
      setTranscript('');
      setInterimTranscript('');
      setSpeechRecognitionError(null);

      // Start recognition
      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults,
        continuous: false, // Single utterance mode
        maxAlternatives: 1,
      });
    } catch (error) {
      console.error('[Voice] Failed to start speech recognition:', error);
      setSpeechRecognitionError('Failed to start speech recognition');
    }
  }, [isListening, language, interimResults]);

  const stopListening = useCallback(() => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
    }
  }, [isListening]);

  const cancelListening = useCallback(() => {
    if (isListening) {
      ExpoSpeechRecognitionModule.abort();
      setInterimTranscript('');
    }
  }, [isListening]);

  // ============================================================================
  // Text-to-Speech Controls
  // ============================================================================

  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !text.trim()) return;

    // Stop any current speech
    Speech.stop();

    setIsSpeaking(true);
    Speech.speak(text, {
      language,
      rate: speechRate,
      pitch: speechPitch,
      onDone: () => {
        setIsSpeaking(false);
        onSpeechDone?.();
      },
      onStopped: () => {
        setIsSpeaking(false);
      },
      onError: (error: unknown) => {
        console.warn('[Voice] TTS error:', error);
        setIsSpeaking(false);
      },
    });
  }, [ttsEnabled, language, speechRate, speechPitch, onSpeechDone]);

  const stopSpeaking = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  // ============================================================================
  // Cleanup
  // ============================================================================

  useEffect(() => {
    return () => {
      // Stop everything on unmount
      if (isListening) {
        ExpoSpeechRecognitionModule.abort();
      }
      Speech.stop();
    };
  }, [isListening]);

  return {
    // Speech Recognition
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    cancelListening,
    speechRecognitionAvailable,
    speechRecognitionError,

    // Text-to-Speech
    isSpeaking,
    speak,
    stopSpeaking,
    ttsEnabled,
    setTtsEnabled,
  };
}
