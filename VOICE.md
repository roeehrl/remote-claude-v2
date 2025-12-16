# Voice Integration - Design & Architecture

This document describes the voice integration feature for the Remote Claude mobile app, enabling hands-free interaction with Claude through speech-to-text (STT) and text-to-speech (TTS).

## Overview

The voice integration allows users to:
- **Speak to Claude**: Tap the microphone button in the chat input to dictate messages
- **Listen to responses**: Enable TTS to have Claude's responses read aloud automatically

This feature is implemented entirely in-app using Expo's speech packages, providing a seamless voice experience without requiring native assistant integration (Siri/Google Assistant).

---

## Packages

### expo-speech (TTS)
- **Version**: ~14.0.8
- **Purpose**: Text-to-Speech - reads Claude's responses aloud
- **Documentation**: https://docs.expo.dev/versions/latest/sdk/speech/

### expo-speech-recognition (STT)
- **Version**: ^0.2.25
- **Purpose**: Speech-to-Text - converts voice input to text
- **Documentation**: https://github.com/jamsch/expo-speech-recognition

---

## Configuration

### app.json

The expo-speech-recognition plugin is configured in `apps/mobile/app.json`:

```json
{
  "plugins": [
    [
      "expo-speech-recognition",
      {
        "microphonePermission": "Allow Remote Claude to use the microphone for voice input.",
        "speechRecognitionPermission": "Allow Remote Claude to use speech recognition for voice commands.",
        "androidSpeechServicePackages": ["com.google.android.googlequicksearchbox"]
      }
    ]
  ]
}
```

### Platform Requirements

**IMPORTANT**: Voice features require a **development build** or **production build**. They will NOT work in Expo Go due to native module requirements.

```bash
# Create development build
npx eas build --profile development --platform ios
npx eas build --profile development --platform android

# Or run locally with development client
npx expo run:ios
npx expo run:android
```

---

## Architecture

### useVoice Hook

Located at: `apps/mobile/hooks/useVoice.ts`

The `useVoice` hook encapsulates all voice functionality:

```typescript
interface UseVoiceOptions {
  language?: string;           // Default: 'en-US'
  interimResults?: boolean;    // Show partial results while speaking
  speechRate?: number;         // TTS speed (default: 1.0)
  speechPitch?: number;        // TTS pitch (default: 1.0)
  onSpeechResult?: (transcript: string) => void;  // Called with final transcript
  onSpeechDone?: () => void;   // Called when TTS finishes
}

interface UseVoiceReturn {
  // Speech Recognition (STT)
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  cancelListening: () => void;
  speechRecognitionAvailable: boolean;
  speechRecognitionError: string | null;

  // Text-to-Speech (TTS)
  isSpeaking: boolean;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
}
```

### Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chat Tab                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Status Bar                             │   │
│  │  [Claude Code]  Status: ● Stable  [TTS Toggle: ON/OFF]   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Message List                            │   │
│  │                                                           │   │
│  │  User: "What is the weather?"                             │   │
│  │                                                           │   │
│  │  Assistant: "I don't have access to weather data..."      │   │
│  │             ↓                                             │   │
│  │        [Auto-speaks if TTS enabled & status=stable]       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Chat Input Bar                          │   │
│  │                                                           │   │
│  │  [MIC] [_________________________] [SEND]                 │   │
│  │    ↑                                                      │   │
│  │  Tap to start listening                                   │   │
│  │  Shows interim transcript while speaking                  │   │
│  │  Auto-sends message when speech ends                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Interface

### Microphone Button (STT)

Located in `ChatInputBar.tsx`:

- **Position**: Left side of the input row
- **Icon**: Microphone icon (changes to stop icon while listening)
- **Animation**: Pulsing animation while listening
- **Behavior**:
  - Tap to start listening
  - Tap again to stop
  - Input field shows interim transcript in real-time
  - When speech recognition ends, the transcript is automatically sent to Claude

### TTS Toggle Button

Located in the chat status bar:

- **Position**: Right side of the status bar
- **Icon**: Volume icon (changes color when enabled)
- **Behavior**:
  - Tap to toggle TTS on/off
  - When enabled, Claude's responses are automatically spoken
  - Only speaks when agent status is "stable" (to avoid reading partial responses)

---

## Implementation Details

### Speech Recognition Flow

1. User taps microphone button
2. Hook requests microphone permission (first time only)
3. Recognition starts with configured language
4. Interim results shown in input field as user speaks
5. When speech ends, final transcript captured
6. `onSpeechResult` callback triggered with transcript
7. Chat tab sends transcript as message to Claude

### Text-to-Speech Flow

1. New assistant message received
2. Check if TTS is enabled
3. Check if agent status is "stable" (response complete)
4. Check if message hasn't been spoken yet (avoid duplicates)
5. Call `speak()` with message content
6. TTS speaks the message

### Error Handling

- **Permission denied**: Error message shown, recognition unavailable
- **Recognition errors**: Logged to console, user notified via error state
- **TTS errors**: Logged to console, speaking state reset

---

## Code References

| File | Description |
|------|-------------|
| `apps/mobile/hooks/useVoice.ts` | Core voice hook implementation |
| `apps/mobile/hooks/index.ts` | Hook exports |
| `apps/mobile/components/chat/ChatInputBar.tsx` | Microphone button UI |
| `apps/mobile/app/(tabs)/chat.tsx` | Voice integration in chat tab |
| `apps/mobile/app.json` | Plugin configuration |

---

## Future Enhancements

Potential improvements for voice integration:

1. **Voice Activity Detection**: Auto-stop listening when silence detected
2. **Wake Word**: "Hey Claude" to start listening hands-free
3. **Voice Selection**: Allow users to choose different TTS voices
4. **Language Settings**: Per-session language selection in settings
5. **Streaming TTS**: Start speaking before full response received
6. **Siri/Google Assistant Integration**: Deep OS integration for launching app via voice assistant

---

## Troubleshooting

### Voice features not working

1. **Ensure you're using a development build**, not Expo Go
2. Check that microphone permissions are granted in device settings
3. On Android, ensure Google app is installed for speech recognition

### TTS not speaking

1. Check that TTS is enabled (toggle in status bar)
2. Wait for agent status to become "stable"
3. Check device volume is not muted

### Recognition not accurate

1. Speak clearly and at moderate pace
2. Reduce background noise
3. Consider adjusting language setting if using non-English

---

## Platform Notes

### iOS
- Uses Apple's native speech recognition
- Requires iOS 13+ for full functionality
- Speech recognition requires internet connection (not offline)

### Android
- Uses Google's speech recognition service
- Requires Google app installed
- May work offline with downloaded language packs
