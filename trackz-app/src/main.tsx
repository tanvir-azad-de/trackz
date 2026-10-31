import { render } from 'preact'
import './styles/globals.css'
import { App } from './app.tsx'
import { seedDevDataIfEmpty } from './dev/seed'

seedDevDataIfEmpty()
render(<App />, document.getElementById('app')!)
