/**
 * expo-speech mock — 签名与真实 API 完全对齐
 * expo-speech@14.x
 */

export const mockVoices = [
  { identifier: 'com.apple.ttsbundle.siri_female_en-AU_compact', language: 'en-AU', name: 'Karen', quality: 300 },
  { identifier: 'com.apple.ttsbundle.siri_female_en-NZ_compact', language: 'en-NZ', name: 'Nicky', quality: 300 },
  { identifier: 'com.apple.voice.compact.en-US.Samantha', language: 'en-US', name: 'Samantha', quality: 300 },
];

export const getAvailableVoicesAsync = jest.fn().mockResolvedValue(mockVoices);

export const speak = jest.fn().mockImplementation(
  (_utterance: string, options?: { onStart?: () => void; onDone?: () => void; onError?: (e: any) => void }) => {
    // 模拟 <200ms 延迟后触发 onStart，再模拟播报时长后触发 onDone
    setTimeout(() => options?.onStart?.(), 50);
    setTimeout(() => options?.onDone?.(), 200);
  }
);

export const stop = jest.fn().mockResolvedValue(undefined);
export const pause = jest.fn().mockResolvedValue(undefined);
export const resume = jest.fn().mockResolvedValue(undefined);
export const isSpeakingAsync = jest.fn().mockResolvedValue(false);

export type Voice = (typeof mockVoices)[number];
export type SpeechOptions = {
  language?: string;
  pitch?: number;
  rate?: number;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};
