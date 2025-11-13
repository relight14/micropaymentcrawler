/**
 * Tier Catalog - Single Source of Truth
 * Canonical pricing, features, and metadata for research tier
 * SIMPLIFIED: Only Pro Package, priced at $0.05 per source
 */

// Per-source pricing rate
export const PER_SOURCE_RATE = 0.05;

// Calculate Pro tier price based on source count
export function calculateProPrice(sourceCount) {
    return sourceCount * PER_SOURCE_RATE;
}

export const TIERS = [
    {
        id: 'pro',
        icon: '⭐',
        title: 'Pro Package',
        price: 0, // Will be calculated dynamically
        priceLabel: '$0.00', // Will be updated dynamically
        subtitle: 'Executive Analysis',
        description: 'Professional research report with strategic insights and executive formatting',
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
        buttonText: 'Generate Pro Report', // Will be updated dynamically with price
        microcopy: 'Trusted by analysts • Ready in ~3 min',
        highlighted: true,
        badge: 'Most Popular'
    }
];

export function getTierById(tierId) {
    return TIERS.find(tier => tier.id === tierId);
}

// Note: These functions are kept for backwards compatibility
// but are less relevant now that we have per-source pricing
export function getBudgetForTier(tierId = 'pro') {
    // With per-source pricing, there's no fixed budget
    // Return a high value to prevent budget warnings
    return 999.99;
}

export function getBudgetThresholds() {
    // With per-source pricing, budgets are dynamic
    // Return high values to effectively disable budget warnings
    return {
        pro: 999.99,
        warningThreshold: 0.8
    };
}
