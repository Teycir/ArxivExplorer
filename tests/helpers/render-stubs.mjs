// Registers the Next stub loader from inside the test process. Doing it here
// (instead of a CLI --import flag) survives tsx re-spawning node for --test:
// Node 22 on CI dropped the flag and the render tests hit the real
// next/navigation, which throws "expected app router to be mounted".
import { register } from 'node:module';
register('./stub-next-loader.mjs', import.meta.url);
