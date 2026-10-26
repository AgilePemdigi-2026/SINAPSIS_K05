import { useTheme } from './hooks/useTheme'
import { Dashboard } from './components/Dashboard'

export default function App() {
  const { isDark } = useTheme()

  return (
    <div className={isDark ? 'dark' : ''}>
      <Dashboard />
    </div>
  )
}
