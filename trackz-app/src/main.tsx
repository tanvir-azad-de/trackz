import { render } from 'preact'
import './styles/globals.css'
import { App } from './app.tsx'
import { seedDevDataIfEmpty } from './dev/seed'
import { installKeyboardScrollGuard } from './app/keyboardScroll'

seedDevDataIfEmpty()
installKeyboardScrollGuard()
render(<App />, document.getElementById('app')!)
