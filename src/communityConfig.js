import {
  Shield,
  Handshake,
  Camera,
  Users,
  Globe,
  Star,
  Briefcase,
  Building2,
} from 'lucide-react';

export const COMMUNITY_ICON_MAP = {
  shield: Shield,
  handshake: Handshake,
  camera: Camera,
  users: Users,
  globe: Globe,
  star: Star,
  briefcase: Briefcase,
  building: Building2,
};

export const COMMUNITY_ICON_OPTIONS = [
  { value: 'shield', label: 'Shield' },
  { value: 'handshake', label: 'Handshake' },
  { value: 'camera', label: 'Camera' },
  { value: 'users', label: 'Users' },
  { value: 'globe', label: 'Globe' },
  { value: 'star', label: 'Star' },
  { value: 'briefcase', label: 'Briefcase' },
  { value: 'building', label: 'Building' },
];

export const DEFAULT_COMMUNITY_CONFIG = {
  communities: [
    {
      id: 'safety',
      title: 'Veiligheid & Consent',
      description: 'Over grenzen, afspraken en veilig werken.',
      iconKey: 'shield',
      topics: ['Consent', 'Grenzen', 'Afspraken'],
    },
    {
      id: 'network',
      title: 'Netwerk & Collabs',
      description: 'Vind je team voor de volgende shoot.',
      iconKey: 'handshake',
      topics: ['Collabs', 'Casting', 'Portfolio'],
    },
    {
      id: 'tech',
      title: 'Techniek & Gear',
      description: "Alles over licht, camera's en lenzen.",
      iconKey: 'camera',
      topics: ['Licht', 'Camera gear', 'Workflow'],
    },
  ],
};

export const DEFAULT_CHALLENGE_CONFIG = {
  label: 'Weekly Challenge',
  title: 'Shadow Play',
  subtitle: 'Thema: "Shadow Play"',
  description: 'Speel met contrast en laat zien hoe jij licht en schaduw inzet.',
  ctaLabel: 'Doe mee',
};

export const normalizeCommunityConfig = (data) => {
  if (!data?.communities || !Array.isArray(data.communities)) {
    return DEFAULT_COMMUNITY_CONFIG;
  }
  const communities = data.communities
    .map((community) => ({
      id: String(community?.id || '').trim(),
      title: String(community?.title || '').trim(),
      description: String(community?.description || community?.desc || '').trim(),
      iconKey: String(community?.iconKey || '').trim() || 'users',
      topics: Array.isArray(community?.topics)
        ? community.topics.map((topic) => String(topic).trim()).filter(Boolean)
        : [],
    }))
    .filter((community) => community.id || community.title || community.description);
  return { communities: communities.length ? communities : DEFAULT_COMMUNITY_CONFIG.communities };
};

export const normalizeChallengeConfig = (data) => {
  if (!data) return DEFAULT_CHALLENGE_CONFIG;
  return {
    label: String(data?.label || DEFAULT_CHALLENGE_CONFIG.label).trim() || DEFAULT_CHALLENGE_CONFIG.label,
    title: String(data?.title || DEFAULT_CHALLENGE_CONFIG.title).trim() || DEFAULT_CHALLENGE_CONFIG.title,
    subtitle: String(data?.subtitle || DEFAULT_CHALLENGE_CONFIG.subtitle).trim() || DEFAULT_CHALLENGE_CONFIG.subtitle,
    description: String(data?.description || DEFAULT_CHALLENGE_CONFIG.description).trim()
      || DEFAULT_CHALLENGE_CONFIG.description,
    ctaLabel: String(data?.ctaLabel || DEFAULT_CHALLENGE_CONFIG.ctaLabel).trim() || DEFAULT_CHALLENGE_CONFIG.ctaLabel,
  };
};
