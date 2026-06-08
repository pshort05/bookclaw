// Self-hosted fonts (keeps CSP 'self'). Latin subset only — the studio UI is
// English; importing the per-weight `latin-*.css` files instead of the full
// `<weight>.css` drops the latin-ext / cyrillic / vietnamese / greek subsets
// that would otherwise be bundled and shipped but never requested.
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-400-italic.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/hanken-grotesk/latin-400.css';
import '@fontsource/hanken-grotesk/latin-500.css';
import '@fontsource/hanken-grotesk/latin-600.css';
import '@fontsource/hanken-grotesk/latin-700.css';
