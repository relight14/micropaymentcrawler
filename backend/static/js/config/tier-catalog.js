/**
 * Tier Catalog - Single Source of Truth
 * Canonical pricing, features, and metadata for all research tiers
 */

export const TIER_PRICING = {
    research: 0.35,
    pro: 0.65
};

export const TIERS = [
    {
        id: 'pro',
        icon: '⭐',
        title: 'Pro Package',
        price: TIER_PRICING.pro,
        priceLabel: `$${TIER_PRICING.pro.toFixed(2)}`,
        subtitle: 'Executive Analysis',
        description: 'Everything in Research plus strategic insights and executive formatting',
        features: [
            'Source compilation & citations',
            'Strategic insights & recommendations',
            'Executive formatting'
        ],
        expandedFeatures: [
            'Professional summary and analysis',
            'Source compilation with citations',
            'Strategic insights and recommendations',
            'Executive summary format',
            'Enhanced formatting and presentation',
            'Ready for download'
        ],
        buttonText: `Generate Pro Report — $${TIER_PRICING.pro.toFixed(2)}`,
        microcopy: 'Trusted by analysts • Ready in ~3 min',
        highlighted: true,
        badge: 'Most Popular'
    },
    {
        id: 'research',
        icon: '🔬',
        title: 'Research Package',
        price: TIER_PRICING.research,
        priceLabel: `Only $${TIER_PRICING.research.toFixed(2)}`,
        subtitle: 'Quick Brief',
        description: 'Professional summary and analysis with source compilation',
        features: [
            'Source compilation & citations',
            'Basic analysis',
            'Download ready'
        ],
        expandedFeatures: [
            'Professional summary and analysis',
            'Source compilation with citations',
            'Ready for download'
        ],
        buttonText: `Basic Report — $${TIER_PRICING.research.toFixed(2)}`,
        highlighted: false
    }
];

export function getTierById(tierId) {
    return TIERS.find(tier => tier.id === tierId);
}

export function getBudgetForTier(tierId) {
    return TIER_PRICING[tierId] || 0;
}

export function getBudgetThresholds() {
    return {
        research: TIER_PRICING.research,
        pro: TIER_PRICING.pro,
        warningThreshold: 0.8
    };
}
