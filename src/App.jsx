import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  Bell,
  Camera,
  CheckCircle,
  ChevronLeft,
  Cloud,
  Edit3,
  ExternalLink,
  Globe,
  Hand,
  Handshake,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Link as LinkIcon,
  Lock,
  MapPin,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken, signOut } from 'firebase/auth';

const safeParseJSON = (value) => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    console.warn('Kon configuratie niet parsen:', error);
    return null;
  }
};

const runtimeFirebaseConfig =
  safeParseJSON(typeof window !== 'undefined' ? window.__firebase_config : null) ||
  safeParseJSON(import.meta.env.VITE_FIREBASE_CONFIG);

const firebaseConfig = runtimeFirebaseConfig || {
  apiKey: 'demo-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo-project',
};

const hasFirebaseConfig = Boolean(runtimeFirebaseConfig?.apiKey && runtimeFirebaseConfig?.projectId);
const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = hasFirebaseConfig ? getAuth(app) : null;
const db = hasFirebaseConfig ? getFirestore(app) : null;
const appId =
  (typeof window !== 'undefined' && window.__app_id) ||
  import.meta.env.VITE_APP_ID ||
  'default-app-id';

const ROLES = [
  { id: 'photographer', label: 'Fotograaf', desc: 'Deel shoots, lichtopstellingen en vind modellen.' },
  { id: 'model', label: 'Model', desc: 'Bouw je portfolio en vind veilige samenwerkingen.' },
  { id: 'artist', label: 'Artist', desc: 'Deel kunstzinnige projecten.' },
  { id: 'stylist', label: 'Stylist', desc: 'Laat je styling werk zien.' },
  { id: 'mua', label: 'MUA', desc: 'Visagie en special effects.' },
  { id: 'hair', label: 'Hairstylist', desc: 'Haarstyling en verzorging.' },
  { id: 'art_director', label: 'Art Director', desc: 'Conceptontwikkeling en visuele regie.' },
  { id: 'retoucher', label: 'Retoucher', desc: 'Nabewerking en high-end retouching.' },
  { id: 'videographer', label: 'Videograaf', desc: 'Video producties en reels.' },
  { id: 'producer', label: 'Producer', desc: 'Productie en planning van shoots.' },
  { id: 'assistent', label: 'Assistent', desc: 'Ondersteuning op de set.' },
  { id: 'agency', label: 'Agency', desc: 'Vertegenwoordig talent.' },
  { id: 'company', label: 'Company', desc: 'Merk, studio of bedrijf.' },
  { id: 'fan', label: 'Fan', desc: 'Volg je favoriete makers en bewaar inspiratie.' },
];

const THEME_STYLES = {
  Nature: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  Landscape: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  Wildlife: 'bg-lime-100 text-lime-800 border-lime-200 dark:bg-lime-900/30 dark:text-lime-300 dark:border-lime-800',
  Macro: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  Boudoir: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
  'Art Nude': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  Maternity: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800',
  Glamour: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 dark:border-fuchsia-800',
  Beauty: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-200 dark:border-pink-800',
  Travel: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
  Product: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  Corporate: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  Automotive: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
  Fashion: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  Conceptual: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  Editorial: 'bg-purple-50 text-purple-900 border-purple-200 dark:bg-purple-900/20 dark:text-purple-200 dark:border-purple-800',
  Abstract: 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200 dark:bg-fuchsia-900/20 dark:text-fuchsia-200 dark:border-fuchsia-800',
  Surreal: 'bg-indigo-50 text-indigo-900 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-800',
  Vintage: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  Food: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  Wedding: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-200 dark:border-yellow-800',
  Family: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-800',
  Portrait: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-700',
  'Black & White': 'bg-slate-800 text-white border-slate-600 dark:bg-white dark:text-slate-900',
  Urban: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-700',
  Street: 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-700',
  Architecture: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/20 dark:text-sky-200 dark:border-sky-700',
  Minimalist: 'bg-white text-blue-900 border-blue-200 dark:bg-slate-950 dark:text-blue-100 dark:border-blue-900',
};

const getThemeStyle = (theme) =>
  THEME_STYLES[theme] ||
  'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';

const THEMES = Object.keys(THEME_STYLES);

const COMMUNITIES = [
  { id: 'safety', title: 'Veiligheid & Consent', icon: Shield, members: 1240, desc: 'Over grenzen, afspraken en veilig werken.' },
  { id: 'network', title: 'Netwerk & Collabs', icon: Handshake, members: 3500, desc: 'Vind je team voor de volgende shoot.' },
  { id: 'tech', title: 'Techniek & Gear', icon: Camera, members: 2100, desc: "Alles over licht, camera's en lenzen." },
];

const TRIGGERS = [
  'Naakt (Artistiek)',
  'Naakt (Expliciet)',
  'Bloed / Gore',
  'Naalden',
  'Spinnen / Insecten',
  'Wapens',
  'Geweld',
  'Eetstoornissen',
  'Zelfbeschadiging',
  'Flitsende beelden',
];

const SEED_USERS = [
  {
    uid: 'user_jax',
    displayName: 'Jax Models',
    bio: 'International Model Agency based in Amsterdam.',
    roles: ['agency', 'company'],
    avatar:
      'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=200',
    themes: ['Fashion', 'Editorial'],
  },
  {
    uid: 'user_sophie',
    displayName: 'Sophie de Vries',
    bio: 'Freelance model met liefde voor vintage.',
    roles: ['model', 'stylist'],
    linkedAgencyName: 'Jax Models',
    linkedAgencyLink: '',
    avatar:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    themes: ['Vintage', 'Fashion'],
  },
  {
    uid: 'user_marcus',
    displayName: 'Marcus Lens',
    bio: 'Capture the silence.',
    roles: ['photographer', 'art_director'],
    avatar:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    themes: ['Architecture', 'Street'],
  },
  {
    uid: 'user_nina',
    displayName: 'Nina Artistry',
    bio: 'MUA specialized in SFX.',
    roles: ['mua', 'artist'],
    avatar:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    themes: ['Beauty', 'Conceptual'],
  },
  {
    uid: 'user_kai',
    displayName: 'Kai Sato',
    bio: 'Nature documentarian.',
    roles: ['photographer', 'fan'],
    avatar:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    themes: ['Nature', 'Landscape'],
  },
  {
    uid: 'user_elena',
    displayName: 'Elena Visuals',
    bio: 'Conceptual photographer.',
    roles: ['photographer', 'retoucher'],
    avatar:
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=200',
    themes: ['Conceptual', 'Black & White'],
  },
  {
    uid: 'user_luna',
    displayName: 'Luna Shade',
    bio: 'Dancer & Art Model.',
    roles: ['model'],
    linkedAgencyName: 'Jax Models',
    avatar:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    themes: ['Art Nude', 'Boudoir'],
  },
  {
    uid: 'user_tom',
    displayName: 'Tom Analog',
    bio: '35mm & 120mm only.',
    roles: ['photographer'],
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200',
    themes: ['Vintage', 'Street'],
  },
];

const SEED_POSTS = [
  {
    id: 'p1',
    title: 'Neon Dreams',
    description: 'Tokyo nights.',
    imageUrl:
      'https://images.unsplash.com/photo-1496442226666-8d4a0e62e6e9?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_marcus',
    authorName: 'Marcus Lens',
    authorRole: 'photographer',
    styles: ['Street', 'Urban'],
    likes: 342,
  },
  {
    id: 'p2',
    title: 'Vintage Soul',
    description: 'Testing 85mm. Credits to Tom for the lens loan!',
    imageUrl:
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_sophie',
    authorName: 'Sophie de Vries',
    authorRole: 'model',
    styles: ['Fashion', 'Vintage'],
    credits: [
      { role: 'photographer', name: 'Tom Analog', uid: 'user_tom' },
      { role: 'mua', name: 'Nina Artistry', uid: 'user_nina' },
    ],
    likes: 890,
  },
  {
    id: 'p3',
    title: 'Golden Hour',
    description: 'Pure nature.',
    imageUrl:
      'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_kai',
    authorName: 'Kai Sato',
    authorRole: 'photographer',
    styles: ['Portrait', 'Nature'],
    likes: 120,
  },
  {
    id: 'p4',
    title: 'Abstract Form',
    description: 'Shadows.',
    imageUrl:
      'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_elena',
    authorName: 'Elena Visuals',
    authorRole: 'artist',
    styles: ['Black & White', 'Abstract', 'Art Nude'],
    triggers: ['Naakt (Artistiek)'],
    sensitive: true,
    likes: 560,
  },
  {
    id: 'p5',
    title: 'Red Lips',
    description: 'Editorial MUA.',
    imageUrl:
      'https://images.unsplash.com/photo-1512413914633-b5043f4041ea?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_nina',
    authorName: 'Nina Artistry',
    authorRole: 'mua',
    styles: ['Beauty', 'Editorial'],
    credits: [{ role: 'model', name: 'Luna Shade', uid: 'user_luna' }],
    likes: 230,
  },
  {
    id: 'p6',
    title: 'Concrete',
    description: 'Look up.',
    imageUrl:
      'https://images.unsplash.com/photo-1470058869958-2a77ade41c02?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_marcus',
    authorName: 'Marcus Lens',
    authorRole: 'photographer',
    styles: ['Architecture', 'Minimalist'],
    likes: 88,
  },
  {
    id: 'p8',
    title: 'Shadow Challenge',
    description: 'Challenge submission.',
    imageUrl:
      'https://images.unsplash.com/photo-1508186225823-0963cf9ab0de?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_elena',
    authorName: 'Elena Visuals',
    authorRole: 'photographer',
    styles: ['Black & White', 'Fine Art'],
    isChallenge: true,
    likes: 1200,
  },
  {
    id: 'p9',
    title: 'The Gaze',
    description: 'Intense.',
    imageUrl:
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_tom',
    authorName: 'Tom Analog',
    authorRole: 'photographer',
    styles: ['Portrait', 'Vintage'],
    credits: [{ role: 'model', name: 'Sophie de Vries', uid: 'user_sophie' }],
    likes: 310,
  },
  {
    id: 'p10',
    title: 'Soft Light',
    description: 'Boudoir.',
    imageUrl:
      'https://images.unsplash.com/photo-1550525811-e5869dd03032?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_luna',
    authorName: 'Luna Shade',
    authorRole: 'model',
    styles: ['Boudoir', 'Portrait'],
    sensitive: true,
    triggers: ['Naakt (Artistiek)'],
    likes: 670,
  },
  {
    id: 'p11',
    title: 'Mountain',
    description: 'Thin air.',
    imageUrl:
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_kai',
    authorName: 'Kai Sato',
    authorRole: 'photographer',
    styles: ['Landscape', 'Travel'],
    likes: 899,
  },
  {
    id: 'p12',
    title: 'Avant Garde',
    description: 'Pushing boundaries.',
    imageUrl:
      'https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?auto=format&fit=crop&q=80&w=800',
    authorId: 'user_nina',
    authorName: 'Nina Artistry',
    authorRole: 'artist',
    styles: ['Fashion', 'Conceptual'],
    likes: 400,
  },
];

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, asChild = false }) => {
  const baseStyle =
    'px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 cursor-pointer';
  const variants = {
    primary:
      'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
    ghost: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400',
    outline: 'border border-white/40 bg-white/10 text-white hover:bg-white/20 backdrop-blur-md',
  };

  if (asChild) return <span className={`${baseStyle} ${variants[variant]} ${className}`}>{children}</span>;
  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Badge = ({ children, colorClass, onClick, className = '' }) => (
  <span
    onClick={(e) => {
      e.stopPropagation();
      onClick && onClick();
    }}
    className={`px-3 py-1 rounded-full text-xs font-semibold border ${
      onClick ? 'cursor-pointer hover:opacity-80' : ''
    } ${colorClass} ${className}`}
  >
    {children}
  </span>
);

const Input = ({ label, type = 'text', placeholder, value, onChange }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
    <input
      type={type}
      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  </div>
);

export default function ExhibitApp() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('loading');
  const [darkMode, setDarkMode] = useState(false);
  const [showTour, setShowTour] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [quickProfileId, setQuickProfileId] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [shadowProfileName, setShadowProfileName] = useState(null);

  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (hasFirebaseConfig) return;
    const demoUser = { uid: 'demo-user' };
    const demoProfile = {
      uid: demoUser.uid,
      displayName: 'Demo Maker',
      bio: 'Demonstratie account zonder Firebase configuratie.',
      roles: ['photographer'],
      themes: ['Nature'],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${demoUser.uid}`,
      linkedAgencyName: '',
      linkedCompanyName: '',
    };
    setUser(demoUser);
    setProfile(demoProfile);
    setPosts(SEED_POSTS);
    setUsers(SEED_USERS);
    setView('gallery');
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) return;
    const initAuth = async () => {
      if (typeof window !== 'undefined' && window.__initial_auth_token) {
        await signInWithCustomToken(auth, window.__initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u && db) {
        const unsubProfile = onSnapshot(doc(db, 'artifacts', appId, 'users', u.uid, 'profile', 'main'), (snap) => {
          if (snap.exists()) {
            setProfile(snap.data());
            if (view === 'loading') setView('gallery');
          } else {
            setView('login');
          }
        });
        return () => unsubProfile();
      }
      setView('login');
    });
    return () => unsubscribe();
  }, [view]);

  useEffect(() => {
    if (!hasFirebaseConfig || !db || !user) return;
    const checkAndSeed = async () => {
      try {
        const check = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', 'user_sophie'));
        if (!check.exists()) {
          const batch = writeBatch(db);
          SEED_USERS.forEach((u) => batch.set(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', u.uid), u));
          SEED_POSTS.forEach((p) => {
            batch.set(doc(db, 'artifacts', appId, 'public', 'data', 'posts', p.id), { ...p, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
      } catch (e) {
        console.error('Seeding error', e);
      }
    };
    checkAndSeed();
  }, [user]);

  useEffect(() => {
    if (!hasFirebaseConfig || !db || !user) return;
    const unsubPosts = onSnapshot(
      query(collection(db, 'artifacts', appId, 'public', 'data', 'posts'), orderBy('createdAt', 'desc')),
      (s) => {
        setPosts(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
    );
    const unsubUsers = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'user_indices'), (s) => {
      setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubPosts();
      unsubUsers();
    };
  }, [user]);

  const toggleTheme = () => setDarkMode((prev) => !prev);
  const canUpload = profile && (!profile.roles?.includes('fan') || profile.roles.length > 1);

  const handleTourComplete = (targetView) => {
    setShowTour(false);
    if (typeof targetView === 'string') setView(targetView);
  };

  const handleLocalPublish = (post) => {
    setPosts((prev) => [{ ...post, id: post.id || `local-${Date.now()}` }, ...prev]);
  };

  const handleLocalProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile);
    setUsers((prev) => {
      const existing = prev.find((u) => u.uid === updatedProfile.uid || u.id === updatedProfile.uid);
      if (existing) {
        return prev.map((u) => (u.uid === updatedProfile.uid || u.id === updatedProfile.uid ? updatedProfile : u));
      }
      return [...prev, updatedProfile];
    });
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} h-screen w-full flex flex-col transition-colors duration-300`}>
      <div className="flex-1 bg-[#F0F4F8] dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-hidden relative font-sans">
        <style
          dangerouslySetInnerHTML={{
            __html: `
           .no-scrollbar::-webkit-scrollbar { display: none; }
           .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `,
          }}
        />

        {profile && (
          <NavBar
            view={view}
            setView={setView}
            profile={profile}
            toggleTheme={toggleTheme}
            darkMode={darkMode}
            onOpenSettings={() => setShowSettingsModal(true)}
          />
        )}

        <main className="h-full overflow-y-auto pb-24 pt-16 scroll-smooth">
          {view === 'loading' && (
            <div className="h-full flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}

          {view === 'login' && <LoginScreen setView={setView} />}

          {view === 'onboarding' && (
            <Onboarding
              isDemo={!hasFirebaseConfig}
              user={user}
              setProfile={setProfile}
              setUsers={setUsers}
              setView={setView}
              users={users}
              startTour={() => setShowTour(true)}
            />
          )}

          {view === 'gallery' && (
            <Gallery
              posts={posts}
              onUserClick={setQuickProfileId}
              onShadowClick={setShadowProfileName}
              onPostClick={setSelectedPost}
              onChallengeClick={() => setView('challenge_detail')}
              profile={profile}
            />
          )}

          {view === 'discover' && (
            <Discover users={users} posts={posts} onUserClick={setQuickProfileId} onPostClick={setSelectedPost} setView={setView} />
          )}

          {view === 'community' && <CommunityList setView={setView} />}
          {view === 'challenge_detail' && (
            <ChallengeDetail setView={setView} posts={posts.filter((p) => p.isChallenge)} onPostClick={setSelectedPost} />
          )}

          {view.startsWith('community_') && <CommunityDetail id={view.split('_')[1]} setView={setView} />}

          {view === 'profile' && (
            <ImmersiveProfile
              profile={profile}
              isOwn={true}
              posts={posts.filter((p) => p.authorId === user?.uid)}
              onOpenSettings={() => setShowEditProfile(true)}
              onPostClick={setSelectedPost}
              allUsers={users}
            />
          )}

          {view.startsWith('profile_') && (
            <FetchedProfile userId={view.split('_')[1]} posts={posts} onPostClick={setSelectedPost} allUsers={users} />
          )}
        </main>

        {profile && view !== 'onboarding' && view !== 'login' && canUpload && (
          <div className="fixed bottom-6 right-6 z-40">
            <button
              onClick={() => setShowUploadModal(true)}
              className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
            >
              <Plus className="w-7 h-7" />
            </button>
          </div>
        )}

        {showUploadModal && (
          <UploadModal
            isDemo={!hasFirebaseConfig}
            onLocalPublish={handleLocalPublish}
            onClose={() => setShowUploadModal(false)}
            user={user}
            profile={profile}
            users={users}
          />
        )}
        {showSettingsModal && (
          <SettingsModal
            onClose={() => setShowSettingsModal(false)}
            profile={profile}
            onLogout={async () => {
              if (auth && hasFirebaseConfig) await signOut(auth);
              setProfile(null);
              setView('login');
            }}
            darkMode={darkMode}
            toggleTheme={toggleTheme}
          />
        )}
        {showEditProfile && (
          <EditProfileModal
            isDemo={!hasFirebaseConfig}
            onLocalProfile={handleLocalProfileUpdate}
            onClose={() => setShowEditProfile(false)}
            profile={profile}
            user={user}
          />
        )}
        {showTour && <WelcomeTour onClose={handleTourComplete} setView={setView} />}

        {quickProfileId && (
          <UserPreviewModal
            userId={quickProfileId}
            onClose={() => setQuickProfileId(null)}
            onFullProfile={() => {
              setView(`profile_${quickProfileId}`);
              setQuickProfileId(null);
            }}
          />
        )}
        {selectedPost && (
          <PhotoDetailModal
            post={selectedPost}
            allPosts={posts}
            onClose={() => setSelectedPost(null)}
            onUserClick={setQuickProfileId}
          />
        )}
        {shadowProfileName && (
          <ShadowProfileModal
            name={shadowProfileName}
            posts={posts}
            onClose={() => setShadowProfileName(null)}
            onPostClick={setSelectedPost}
          />
        )}
      </div>
    </div>
  );
}

function LoginScreen({ setView }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-bold text-4xl mb-6 shadow-xl shadow-blue-500/20 mx-auto">
          E
        </div>
        <h1 className="text-4xl font-bold mb-2 dark:text-white">Exhibit</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8 text-lg">Connect, Create, Inspire.</p>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-700">
          <div className="space-y-4">
            <Input label="E-mailadres" placeholder="naam@voorbeeld.nl" />
            <Input label="Wachtwoord" type="password" placeholder="••••••••" />
            <Button className="w-full" onClick={() => setView('gallery')}>
              Inloggen
            </Button>
          </div>
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white dark:bg-slate-800 text-slate-500">Nieuw hier?</span>
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setView('onboarding')}>
            Account aanmaken
          </Button>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ user, setProfile, setView, users, startTour, isDemo, setUsers }) {
  const [step, setStep] = useState(1);
  const [roles, setRoles] = useState([]);
  const [profileData, setProfileData] = useState({ displayName: '', bio: '', insta: '', linkedAgencyName: '', linkedCompanyName: '' });

  if (step === 1)
    return (
      <div className="max-w-md mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-1">Stap 1/4</h2>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Welkom bij Exhibit</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">Maak een account aan om te beginnen.</p>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <Input label="E-mailadres" />
          <Input label="Wachtwoord" type="password" />
          <Button onClick={() => setStep(2)} className="w-full">
            Account aanmaken
          </Button>
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div className="max-w-lg mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 2/4</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Veiligheid & Waarden</h1>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border dark:border-slate-700 space-y-6">
          <div className="flex gap-3">
            <Shield className="text-blue-500" />
            <p className="text-sm dark:text-slate-300">Bij Exhibit staan respect en consent centraal.</p>
          </div>
          <div className="flex gap-3">
            <CheckCircle className="text-green-500" />
            <p className="text-sm dark:text-slate-300">Identificatie via Didit is verplicht voor veiligheid.</p>
          </div>
          <Button onClick={() => setStep(3)} className="w-full">
            Start Didit Verificatie
          </Button>
        </div>
      </div>
    );

  if (step === 3)
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 3/4</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Kies je rol(len)</h1>
        <div className="grid grid-cols-2 gap-4 mb-8 h-96 overflow-y-auto no-scrollbar">
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() =>
                setRoles((prev) => (prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]))
              }
              className={`p-4 border-2 rounded-xl text-left transition-all ${
                roles.includes(r.id) ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="font-bold text-sm dark:text-white">{r.label}</div>
              <div className="text-xs text-slate-500">{r.desc}</div>
            </button>
          ))}
        </div>
        <Button onClick={() => setStep(4)} disabled={roles.length === 0} className="w-full">
          Volgende
        </Button>
      </div>
    );

  const completeProfile = async () => {
    if (!user) return;
    const finalProfile = {
      uid: user.uid,
      displayName: profileData.displayName || 'Nieuwe Maker',
      bio: profileData.bio,
      roles: roles,
      themes: ['General'],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
      linkedAgencyName: profileData.linkedAgencyName,
      linkedCompanyName: profileData.linkedCompanyName,
      createdAt: hasFirebaseConfig ? serverTimestamp() : new Date().toISOString(),
    };

    if (isDemo || !hasFirebaseConfig || !db) {
      setProfile(finalProfile);
      setUsers?.((prev) => [...prev, finalProfile]);
      setView('gallery');
      startTour();
      return;
    }

    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main'), finalProfile);
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', user.uid), finalProfile);
    setProfile(finalProfile);
    setView('gallery');
    startTour();
  };

  if (step === 4)
    return (
      <div className="max-w-lg mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 4/4</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Maak je profiel af</h1>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border dark:border-slate-700 space-y-4">
          <Input
            label="Weergavenaam"
            value={profileData.displayName}
            onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
          />
          <Input label="Korte bio" value={profileData.bio} onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })} />

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">Agency (Optioneel)</label>
              <input
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                placeholder="Naam Agency"
                value={profileData.linkedAgencyName}
                onChange={(e) => setProfileData({ ...profileData, linkedAgencyName: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf/Studio (Optioneel)</label>
              <input
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                placeholder="Naam Bedrijf"
                value={profileData.linkedCompanyName}
                onChange={(e) => setProfileData({ ...profileData, linkedCompanyName: e.target.value })}
              />
            </div>
          </div>

          <Button className="w-full mt-4" onClick={completeProfile}>
            Afronden
          </Button>
        </div>
      </div>
    );
}

function Gallery({ posts, onUserClick, profile, onChallengeClick, onPostClick, onShadowClick }) {
  const [sensitiveRevealed, setSensitiveRevealed] = useState({});
  const preference = profile?.preferences?.sensitiveContent || 'cover';
  const visiblePosts = posts.filter((p) => {
    if (!p.sensitive) return true;
    if (preference === 'block') return false;
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-12">
      {visiblePosts.map((post) => (
        <div key={post.id} className="relative group">
          <div
            className={`relative overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800 min-h-[300px] shadow-sm cursor-pointer ${
              post.isChallenge ? 'ring-4 ring-amber-400' : ''
            }`}
            onClick={() => onPostClick(post)}
          >
            {post.sensitive && !sensitiveRevealed[post.id] && preference === 'cover' ? (
              <div
                className="absolute inset-0 z-10 backdrop-blur-3xl bg-slate-900/80 flex flex-col items-center justify-center p-6 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <AlertOctagon className="w-12 h-12 text-orange-500 mb-4" />
                <h4 className="text-white font-bold text-lg mb-2">Gevoelige inhoud</h4>
                <Button variant="outline" onClick={() => setSensitiveRevealed((prev) => ({ ...prev, [post.id]: true }))}>
                  Toch bekijken
                </Button>
              </div>
            ) : null}
            <img src={post.imageUrl} className="w-full h-auto object-cover block" loading="lazy" />
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-b-xl shadow-xl p-5 mt-2 border border-slate-100 dark:border-slate-700 flex gap-6">
            <div className="flex-1 space-y-3">
              <div className="flex gap-4">
                <Hand className="w-6 h-6" />
                <Cloud className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-serif font-bold dark:text-white">{post.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{post.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {post.styles?.map((s) => (
                  <Badge key={s} colorClass={getThemeStyle(s)}>
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="text-right flex flex-col gap-2">
              <div className="cursor-pointer group" onClick={() => onUserClick(post.authorId)}>
                <div className="text-xs uppercase font-bold text-slate-400">{ROLES.find((r) => r.id === post.authorRole)?.label}</div>
                <div className="text-xs font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors">
                  {post.authorName}
                </div>
              </div>
              {post.credits &&
                post.credits.map((c, i) => (
                  <div key={i} className="cursor-pointer group" onClick={() => (c.uid ? onUserClick(c.uid) : onShadowClick(c.name))}>
                    <div className="text-xs uppercase font-bold text-slate-400">{ROLES.find((r) => r.id === c.role)?.label || c.role}</div>
                    <div className="text-xs font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors flex items-center justify-end gap-1">
                      {c.name} {!c.uid && <ExternalLink className="w-3 h-3 text-slate-400" />}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Discover({ users, posts, onUserClick, onPostClick, setView }) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [activeThemes, setActiveThemes] = useState([]);
  const [activeRole, setActiveRole] = useState(null);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [showAllRoles, setShowAllRoles] = useState(false);

  const displayedThemes = showAllThemes ? THEMES : THEMES.slice(0, 5);
  const displayedRoles = showAllRoles ? ROLES : ROLES.slice(0, 5);

  const toggleTheme = (t) => setActiveThemes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const mixedContent = useMemo(() => {
    if (tab !== 'all') return [];
    const res = [];
    const max = Math.max(users.length, posts.length);
    for (let i = 0; i < max; i++) {
      if (posts[i]) res.push({ type: 'post', data: posts[i] });
      if (users[i]) res.push({ type: 'user', data: users[i] });
    }
    return res.filter((i) => (i.type === 'post' ? i.data.title : i.data.displayName).toLowerCase().includes(search.toLowerCase()));
  }, [users, posts, search, tab]);

  const filteredPosts = posts.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) &&
      (activeThemes.length === 0 || p.styles?.some((s) => activeThemes.includes(s))),
  );
  const filteredUsers = users.filter(
    (u) => u.displayName.toLowerCase().includes(search.toLowerCase()) && (!activeRole || u.roles?.includes(activeRole)),
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="sticky top-0 bg-[#F0F4F8] dark:bg-slate-900 z-30 pb-4">
        <div className="relative mb-4">
          <Search className="absolute left-4 top-3.5 text-slate-400" />
          <input
            className="w-full pl-12 pr-4 py-3 rounded-2xl border-none shadow-sm dark:bg-slate-800 dark:text-white"
            placeholder="Zoeken..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 mb-4">
          {['all', 'ideas', 'people'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${
                tab === t ? 'bg-white shadow text-blue-600 dark:bg-slate-700 dark:text-white' : 'text-slate-500'
              }`}
            >
              {t === 'all' ? 'Alles' : t === 'ideas' ? 'Ideeën' : 'Mensen'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'all' && (
        <div className="columns-2 md:columns-4 gap-4 space-y-4">
          {mixedContent.map((item, i) => (
            <div
              key={i}
              onClick={() => (item.type === 'post' ? onPostClick(item.data) : onUserClick(item.data.uid))}
              className="break-inside-avoid bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm cursor-pointer mb-4"
            >
              <img src={item.type === 'post' ? item.data.imageUrl : item.data.avatar} className="w-full h-auto" />
              <div className="p-2 font-bold text-xs truncate dark:text-white">
                {item.type === 'post' ? item.data.title : item.data.displayName}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'ideas' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            {displayedThemes.map((t) => (
              <button
                key={t}
                onClick={() => toggleTheme(t)}
                className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                  activeThemes.includes(t)
                    ? 'ring-2 ring-blue-500 ' + getThemeStyle(t)
                    : 'bg-white dark:bg-slate-800 text-slate-500'
                }`}
              >
                {t}
              </button>
            ))}
            <button onClick={() => setShowAllThemes(!showAllThemes)} className="text-xs font-bold text-blue-600 px-4">
              Toon meer...
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {filteredPosts.map((p) => (
              <div key={p.id} onClick={() => onPostClick(p)} className="aspect-[4/5] bg-slate-200 rounded-lg overflow-hidden cursor-pointer">
                <img src={p.imageUrl} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'people' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            <button onClick={() => setActiveRole(null)} className="px-4 py-2 rounded-full text-xs font-bold bg-blue-600 text-white">
              Iedereen
            </button>
            {displayedRoles.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRole(r.id)}
                className={`px-4 py-2 rounded-full text-xs font-bold border ${
                  activeRole === r.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'
                }`}
              >
                {r.label}
              </button>
            ))}
            <button onClick={() => setShowAllRoles(!showAllRoles)} className="text-xs font-bold text-blue-600 px-4">
              Toon meer...
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {filteredUsers.map((u) => (
              <div
                key={u.uid || u.id}
                onClick={() => onUserClick(u.uid)}
                className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm cursor-pointer"
              >
                <div className="aspect-square relative">
                  <img src={u.avatar} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3">
                    <span className="text-white font-bold">{u.displayName}</span>
                    <span className="text-white/70 text-xs">{ROLES.find((r) => r.id === u.roles?.[0])?.label}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NavBar({ view, setView, onOpenSettings }) {
  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-30 flex items-center justify-between px-6">
        <div className="font-bold text-xl dark:text-white cursor-pointer" onClick={() => setView('gallery')}>
          Exhibit
        </div>
        <div className="hidden md:flex gap-6">
          {['gallery', 'discover', 'community'].map((v) => (
            <button key={v} onClick={() => setView(v)} className={`capitalize font-medium ${view === v ? 'text-blue-600' : 'text-slate-500'}`}>
              {v === 'discover' ? 'Ontdekken' : v === 'gallery' ? 'Galerij' : v}
            </button>
          ))}
          <button onClick={() => setView('profile')} className={`capitalize font-medium ${view === 'profile' ? 'text-blue-600' : 'text-slate-500'}`}>
            Mijn Portfolio
          </button>
        </div>
        <button onClick={onOpenSettings}>
          <Settings className="w-5 h-5 text-slate-500" />
        </button>
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-30 flex items-center justify-around">
        <button onClick={() => setView('gallery')} className={view === 'gallery' ? 'text-blue-600' : 'text-slate-400'}>
          <ImageIcon />
        </button>
        <button onClick={() => setView('discover')} className={view === 'discover' ? 'text-blue-600' : 'text-slate-400'}>
          <Search />
        </button>
        <button onClick={() => setView('community')} className={view === 'community' ? 'text-blue-600' : 'text-slate-400'}>
          <Users />
        </button>
        <button onClick={() => setView('profile')} className={view === 'profile' ? 'text-blue-600' : 'text-slate-400'}>
          <User />
        </button>
      </div>
    </>
  );
}

function ImmersiveProfile({ profile, isOwn, posts, onOpenSettings, onPostClick }) {
  if (!profile) return null;
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 pb-20">
      <div className="relative h-[500px] w-full overflow-hidden">
        <img src={profile.avatar} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/90" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white dark:from-slate-900 to-transparent z-10" />

        {isOwn && (
          <div className="absolute top-4 right-4 z-20">
            <Button onClick={onOpenSettings} className="bg-black/50 text-white hover:bg-black/70 border-none backdrop-blur-md">
              <Edit3 className="w-4 h-4 mr-2" /> Profiel Bewerken
            </Button>
          </div>
        )}

        <div className="relative z-20 h-full flex flex-col justify-end items-center pb-12 px-6 text-center">
          <h1 className="text-5xl font-bold text-white mb-2">{profile.displayName}</h1>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {profile.roles?.map((r) => (
              <span key={r} className="text-xs font-bold uppercase tracking-widest text-white/80 bg-white/10 px-3 py-1 rounded backdrop-blur">
                {ROLES.find((x) => x.id === r)?.label}
              </span>
            ))}
            {profile.linkedAgencyName && <span className="text-xs text-white/80 border-l border-white/30 pl-2 ml-2">Agency: {profile.linkedAgencyName}</span>}
            {profile.linkedCompanyName && <span className="text-xs text-white/80 border-l border-white/30 pl-2 ml-2">Work: {profile.linkedCompanyName}</span>}
          </div>
          <p className="text-slate-200 max-w-xl text-lg">{profile.bio}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 relative z-20">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {posts.map((p) => (
            <div key={p.id} onClick={() => onPostClick(p)} className="aspect-[4/5] bg-slate-200 rounded-sm overflow-hidden cursor-pointer">
              <img src={p.imageUrl} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
        {posts.length === 0 && <p className="text-center text-slate-500 py-10">Nog geen posts.</p>}
      </div>
    </div>
  );
}

function UploadModal({ onClose, user, profile, users, isDemo, onLocalPublish }) {
  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [credits, setCredits] = useState([]);
  const [newCredit, setNewCredit] = useState({ role: 'model', name: '', link: '' });
  const [showInvite, setShowInvite] = useState(false);
  const [isSensitive, setIsSensitive] = useState(false);
  const [activeTriggers, setActiveTriggers] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [uploaderRole, setUploaderRole] = useState(profile.roles[0]);

  const [contributorSearch, setContributorSearch] = useState('');
  const searchResults = useMemo(() => {
    if (!contributorSearch) return [];
    return users.filter((u) => u.displayName.toLowerCase().includes(contributorSearch.toLowerCase()));
  }, [users, contributorSearch]);

  const handleFile = (e) => {
    if (e.target.files[0]) {
      const r = new FileReader();
      r.onload = (ev) => {
        setImage(ev.target.result);
        setStep(2);
      };
      r.readAsDataURL(e.target.files[0]);
    }
  };

  const simulateAI = () => {
    setAiLoading(true);
    setTimeout(() => {
      setIsSensitive(true);
      setActiveTriggers(['Naakt (Artistiek)']);
      setAiLoading(false);
    }, 800);
  };

  const addCredit = (foundUser) => {
    if (foundUser) {
      setCredits([...credits, { role: newCredit.role, name: foundUser.displayName, uid: foundUser.uid }]);
      setContributorSearch('');
      setNewCredit({ ...newCredit, name: '' });
    } else {
      if (!newCredit.name) return;
      setCredits([...credits, { role: newCredit.role, name: newCredit.name, link: newCredit.link, isExternal: true }]);
      setContributorSearch('');
      setNewCredit({ role: 'model', name: '', link: '' });
      setShowInvite(false);
    }
  };

  const handlePublish = async () => {
    const payload = {
      title,
      description: desc,
      imageUrl: image,
      authorId: user?.uid,
      authorName: profile.displayName,
      authorRole: uploaderRole,
      styles: selectedStyles,
      sensitive: isSensitive,
      triggers: activeTriggers,
      credits,
      likes: 0,
      createdAt: serverTimestamp(),
    };

    if (isDemo || !hasFirebaseConfig || !db) {
      onLocalPublish?.({ ...payload, createdAt: new Date().toISOString() });
      onClose();
      return;
    }

    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'posts'), payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[85vh] rounded-3xl overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between">
          <h3 className="font-bold dark:text-white">Beeld publiceren</h3>
          <button onClick={onClose}>
            <X className="dark:text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          {step === 1 ? (
            <div className="h-full border-2 border-dashed rounded-3xl flex items-center justify-center relative">
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile} />
              <Plus className="w-10 h-10 text-slate-400" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="aspect-[4/5] bg-slate-100 rounded-xl overflow-hidden relative">
                  <img src={image} className="w-full h-full object-cover" />
                  {isSensitive && (
                    <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center text-orange-400 font-bold">
                      <AlertOctagon className="w-6 h-6 mr-2" /> Sensitive Content
                    </div>
                  )}
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-bold flex items-center gap-2 dark:text-white">
                      <Shield className="w-4 h-4" /> Safety Check
                    </span>
                    <button onClick={simulateAI} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {aiLoading ? '...' : 'AI Scan'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer dark:text-white">
                    <input type="checkbox" checked={isSensitive} onChange={(e) => setIsSensitive(e.target.checked)} /> Markeer als gevoelig
                  </label>
                  {isSensitive && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {TRIGGERS.map((t) => (
                        <button
                          key={t}
                          onClick={() =>
                            setActiveTriggers((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
                          }
                          className={`text-[10px] px-2 py-1 rounded border ${
                            activeTriggers.includes(t) ? 'bg-orange-100 text-orange-800' : ''
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-6">
                <Input label="Titel" value={title} onChange={(e) => setTitle(e.target.value)} />
                <div>
                  <label className="text-sm font-normal block mb-2 dark:text-white">Bijschrift</label>
                  <textarea
                    className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>

                {profile.roles.length > 1 && (
                  <div>
                    <label className="text-sm font-bold block mb-2 dark:text-white">Jouw Rol</label>
                    <div className="flex gap-2">
                      {profile.roles.map((r) => (
                        <button
                          key={r}
                          onClick={() => setUploaderRole(r)}
                          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                            uploaderRole === r ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 dark:text-white'
                          }`}
                        >
                          {ROLES.find((x) => x.id === r)?.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border">
                  <label className="text-sm font-bold block mb-2 dark:text-white">Bijdragers</label>
                  <div className="flex gap-2 mb-2">
                    <select className="p-2 border rounded text-sm w-1/3" value={newCredit.role} onChange={(e) => setNewCredit({ ...newCredit, role: e.target.value })}>
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <input
                        className="w-full p-2 border rounded text-sm"
                        placeholder="Zoek naam..."
                        value={contributorSearch || newCredit.name}
                        onChange={(e) => {
                          setContributorSearch(e.target.value);
                          setNewCredit({ ...newCredit, name: e.target.value });
                          if (!e.target.value) setShowInvite(false);
                        }}
                      />
                      {contributorSearch && searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg max-h-40 overflow-y-auto z-10">
                          {searchResults.map((u) => (
                            <div key={u.uid} className="p-2 hover:bg-slate-100 cursor-pointer text-sm" onClick={() => addCredit(u)}>
                              {u.displayName}
                            </div>
                          ))}
                        </div>
                      )}
                      {contributorSearch && searchResults.length === 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg p-2 z-10">
                          <p className="text-xs text-orange-500 mb-2">Geen gebruiker gevonden.</p>
                          <button onClick={() => setShowInvite(true)} className="text-xs bg-slate-100 p-1 rounded w-full">
                            Voeg toe als extern
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {showInvite && (
                    <div className="bg-yellow-50 p-3 rounded text-xs text-yellow-800 mb-2 border border-yellow-200">
                      <p className="mb-2 font-semibold">Tijdelijk profiel aanmaken voor {newCredit.name}</p>
                      <input
                        className="w-full p-2 rounded border mb-2"
                        placeholder="Website / Instagram Link (Optioneel)"
                        value={newCredit.link}
                        onChange={(e) => setNewCredit({ ...newCredit, link: e.target.value })}
                      />
                      <button onClick={() => addCredit(null)} className="w-full bg-yellow-600 text-white py-1 rounded">
                        Toevoegen
                      </button>
                    </div>
                  )}

                  <div className="space-y-1">
                    {credits.map((c, i) => (
                      <div key={i} className="flex justify-between items-center text-xs bg-white dark:bg-slate-700 p-2 rounded border dark:border-slate-600">
                        <span className="dark:text-white">
                          <span className="font-bold capitalize">{ROLES.find((r) => r.id === c.role)?.label}:</span> {c.name}
                        </span>
                        <div className="flex gap-2 items-center">
                          {c.isExternal && <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">Extern</span>}
                          <button onClick={() => setCredits(credits.filter((_, idx) => idx !== i))}>
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-bold block mb-2 dark:text-white">Thema's</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto no-scrollbar">
                    {THEMES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setSelectedStyles((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}
                        className={`px-2 py-1 rounded text-xs border ${selectedStyles.includes(t) ? 'bg-blue-600 text-white' : ''} ${getThemeStyle(t)}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <Button onClick={handlePublish} className="w-full">
                  Publiceren
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({ onClose, profile, user, isDemo, onLocalProfile }) {
  const [formData, setFormData] = useState({ ...profile });
  const [agencySearch, setAgencySearch] = useState('');
  const [tab, setTab] = useState('general');

  const handleSave = async () => {
    if (isDemo || !hasFirebaseConfig || !db) {
      onLocalProfile?.(formData);
      onClose();
      return;
    }

    await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main'), formData);
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', user.uid), formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-[80vh] rounded-3xl overflow-hidden flex flex-col">
        <div className="p-6 border-b flex justify-between">
          <h3 className="font-bold text-lg dark:text-white">Profiel Bewerken</h3>
          <button onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="flex gap-4 border-b mb-4">
            {['Algemeen', 'Rollen', 'Stijlen'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t.toLowerCase())}
                className={`pb-2 ${tab === t.toLowerCase() ? 'border-b-2 border-blue-600 font-bold' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'general' && (
            <>
              <Input label="Weergavenaam" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} />
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bio</label>
                <textarea
                  className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white h-24"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                />
              </div>

              <div className="border-t pt-6">
                <h4 className="font-bold mb-4 dark:text-white">Connecties</h4>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">Agency (Naam)</label>
                    <input
                      className="w-full p-3 rounded-xl border mb-2 dark:bg-slate-800 dark:text-white"
                      placeholder="Typ naam..."
                      value={agencySearch || formData.linkedAgencyName}
                      onChange={(e) => {
                        setAgencySearch(e.target.value);
                        setFormData({ ...formData, linkedAgencyName: e.target.value, linkedAgencyId: '' });
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf (Naam)</label>
                    <input
                      className="w-full p-3 rounded-xl border mb-2 dark:bg-slate-800 dark:text-white"
                      placeholder="Typ naam..."
                      value={formData.linkedCompanyName}
                      onChange={(e) => setFormData({ ...formData, linkedCompanyName: e.target.value, linkedCompanyId: '' })}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'rollen' && (
            <div>
              <p className="text-sm text-slate-500">Rol selectie hier...</p>
            </div>
          )}
        </div>
        <div className="p-6 border-t flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuleren
          </Button>
          <Button onClick={handleSave}>Opslaan</Button>
        </div>
      </div>
    </div>
  );
}

function CommunityList({ setView }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">Community</h2>
        </div>
        <Button variant="secondary" className="px-4 py-2 text-sm h-10">
          Chat
        </Button>
      </div>

      <div className="mb-8 cursor-pointer" onClick={() => setView('challenge_detail')}>
        <div className="bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/20 p-6 rounded-2xl border border-amber-200 dark:border-amber-800/30 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div>
            <h3 className="font-bold text-amber-900 dark:text-amber-400 text-lg mb-1 flex items-center gap-2">
              <Star className="w-5 h-5 fill-amber-500 text-amber-500" /> Weekly Challenge
            </h3>
            <p className="text-sm text-amber-800 dark:text-amber-200/80 mb-0">Thema: "Shadow Play"</p>
          </div>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20" asChild>
            Doe mee
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {COMMUNITIES.map((comm) => {
          const Icon = comm.icon;
          return (
            <div
              key={comm.id}
              className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex gap-6 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setView(`community_${comm.id}`)}
            >
              <div className="w-12 h-12 bg-blue-50 dark:bg-slate-700 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg dark:text-white mb-1">{comm.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm">{comm.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommunityDetail({ id, setView }) {
  return (
    <div className="p-6">
      <Button onClick={() => setView('community')}>Terug</Button> Community Detail voor {id}
    </div>
  );
}

function ChallengeDetail({ setView, posts, onPostClick }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <button onClick={() => setView('community')} className="flex items-center text-slate-500 hover:text-slate-800 mb-6 font-medium">
        <ChevronLeft className="w-4 h-4 mr-1" /> Terug
      </button>
      <div className="bg-amber-100 dark:bg-amber-900/20 p-8 rounded-3xl border border-amber-200 dark:border-amber-800 mb-8 text-center relative overflow-hidden">
        <h1 className="text-4xl font-bold text-amber-900 dark:text-amber-100 mb-2">Shadow Play</h1>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-4">
        {posts.map((post) => (
          <div key={post.id} onClick={() => onPostClick(post)} className="aspect-square bg-slate-200 rounded-lg overflow-hidden cursor-pointer">
            <img src={post.imageUrl} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FetchedProfile({ userId, posts, onPostClick, allUsers }) {
  const [fetchedUser, setFetchedUser] = useState(null);
  useEffect(() => {
    const existing = allUsers.find((u) => u.uid === userId);
    if (existing) setFetchedUser(existing);
    else if (hasFirebaseConfig && db) {
      getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', userId)).then((s) => {
        if (s.exists()) setFetchedUser(s.data());
      });
    }
  }, [userId, allUsers]);
  if (!fetchedUser) return <div>Loading...</div>;
  return <ImmersiveProfile profile={fetchedUser} isOwn={false} posts={posts.filter((p) => p.authorId === userId)} onPostClick={onPostClick} allUsers={allUsers} />;
}

function PhotoDetailModal({ post, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-10">
      <img src={post.imageUrl} className="max-h-full" />
      <button onClick={onClose} className="absolute top-4 right-4 text-white">
        <X />
      </button>
    </div>
  );
}

function UserPreviewModal({ userId, onClose, onFullProfile }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl text-center">
        <h3>Quick Profile {userId}</h3>
        <Button onClick={onFullProfile}>Bekijk Profiel</Button>
        <Button onClick={onClose} variant="ghost">
          Sluiten
        </Button>
      </div>
    </div>
  );
}

function ShadowProfileModal({ name, posts, onClose, onPostClick }) {
  const shadowPosts = posts.filter((p) => p.credits && p.credits.some((c) => c.name === name));
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4">
      <div className="bg-slate-900 w-full max-w-4xl h-full rounded-3xl overflow-hidden flex flex-col">
        <div className="h-64 bg-indigo-900 flex items-center justify-center flex-col text-white">
          <div className="text-4xl font-bold mb-2">{name}</div>
          <p>Tijdelijk Profiel. Claim dit profiel.</p>
          <button onClick={onClose} className="absolute top-4 right-4">
            <X />
          </button>
        </div>
        <div className="flex-1 p-6 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            {shadowPosts.map((p) => (
              <div key={p.id} onClick={() => onPostClick(p)} className="aspect-square bg-slate-800">
                <img src={p.imageUrl} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, darkMode, toggleTheme }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
      <div className="bg-white w-80 h-full p-6 flex flex-col gap-6">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-xl">Instellingen</h3>
          <button onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="space-y-4">
          <h4 className="text-xs uppercase font-bold text-slate-400">Account</h4>
          <div className="p-3 bg-slate-50 rounded flex justify-between">
            <span>Meldingen</span>
            <Bell className="w-4 h-4" />
          </div>
          <div className="p-3 bg-slate-50 rounded flex justify-between">
            <span>Privacy</span>
            <Lock className="w-4 h-4" />
          </div>
          <h4 className="text-xs uppercase font-bold text-slate-400">Weergave</h4>
          <button onClick={toggleTheme} className="p-3 bg-slate-50 rounded flex justify-between items-center">
            <span>Dark Mode</span>
            {darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <div className="p-3 bg-slate-50 rounded flex justify-between">
            <span>Taal</span>
            <Globe className="w-4 h-4" />
          </div>
          <h4 className="text-xs uppercase font-bold text-slate-400">Overig</h4>
          <div className="p-3 bg-slate-50 rounded flex justify-between">
            <span>Support</span>
            <HelpCircle className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeTour({ onClose, setView }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: 'Welkom bij Exhibit!', desc: 'Dit is een demoversie. Feedback is welkom via Instagram @maraeliza.portfolio.', icon: Info, action: null },
    { title: 'De Galerij', desc: 'Hier vind je inspirerend werk van mensen die je volgt.', icon: ImageIcon, action: 'gallery' },
    { title: 'Ontdekken', desc: 'Zoek nieuwe makers, ideeën en connecties.', icon: Search, action: 'discover' },
    { title: 'Community', desc: 'Praat mee over veiligheid, techniek en samenwerkingen.', icon: Users, action: 'community' },
    { title: 'Jouw Portfolio', desc: 'Je visitekaartje. Beheer je werk en connecties.', icon: User, action: 'profile' },
  ];

  useEffect(() => {
    if (steps[step].action) setView(steps[step].action);
  }, [step]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 max-w-sm w-full rounded-3xl p-8 shadow-2xl relative text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-600 dark:text-blue-400">
          <Star className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold mb-3 dark:text-white">{steps[step].title}</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-8">{steps[step].desc}</p>

        {step < steps.length - 1 ? (
          <div className="flex gap-3">
            <Button onClick={() => setStep(step + 1)} className="w-full">
              Volgende
            </Button>
          </div>
        ) : (
          <div className="flex gap-3 flex-col">
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep(0)} className="flex-1">
                Herhaal Tour
              </Button>
              <Button onClick={onClose} className="flex-1">
                Begrepen
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-2">Veel plezier met Exhibit!</p>
          </div>
        )}

        <div className="flex justify-center gap-2 mt-6">
          {steps.map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

