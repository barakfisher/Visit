import { Home } from '@/components/Home.component';
import { useHome } from '@/src/lib/Home.hook';
export default function HomeScreen() { return <Home {...useHome()} />; }
