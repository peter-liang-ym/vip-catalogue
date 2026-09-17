/**
 * Browser entry point: mounts the app shell. Everything else — routing, the
 * Query_State, the Dataset load — lives in `app.tsx`.
 */

import { render } from 'preact';
import { App } from './app';
import './styles/base.css';
import './styles/controls.css';
import './styles/layout.css';
import './styles/primitives.css';
import './styles/tokens.css';
// Per-view stylesheets last, so a surface can adjust what the shared files set.
import './styles/calendar.css';
import './styles/detail.css';
import './styles/listing.css';
import './styles/load.css';

const root = document.getElementById('app');
if (root !== null) render(<App />, root);
