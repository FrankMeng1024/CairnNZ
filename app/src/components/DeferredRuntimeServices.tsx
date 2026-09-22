import { PassiveMemoryRecorder } from '../features/memory/components/PassiveMemoryRecorder';

/** Post-first-commit boundary for the Memory/Simulator native module graph. */
export default function DeferredRuntimeServices() {
  return <PassiveMemoryRecorder />;
}
