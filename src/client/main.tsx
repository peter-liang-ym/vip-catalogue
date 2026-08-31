/**
 * Browser entry point: mounts the app shell. Everything else — routing, the
 * Query_State, the Dataset load — lives in `app.tsx`.
 */

import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('app');
if (root !== null) render(<App />, root);
