const translations = {
    'zh': {
        'nav.research': '研究',
        'nav.safety': '安全',
        'nav.developer': '开发者专区',
        'nav.company': '公司',
        'nav.news': '新闻',
        'nav.contact': '联系我们',
        'nav.login': '登录',
        'nav.try': '使用 NexusV ↗',
        'search.placeholder': '与虚拟意识对话',
        'hero.overlay': 'Infusing Life into San Andreas',
        'hero.title': '赋予洛圣都数字灵魂',
        'hero.author': 'Nexus 实验室',
        'hero.time': '5 分钟深度阅读',
        'cta.title': '开始使用 Nexus V',
        'cta.btn': '立即体验 ↗',
        'footer.research': '研究',
        'footer.research_index': '研究索引',
        'footer.research_overview': '研究概述',
        'footer.latest_progress': '最新进展',
        'footer.open_cognition': '开放认知',
        'footer.nexus_agent': 'Nexus Agent',
        'footer.personal': '个人版',
        'footer.enterprise': '企业版',
        'footer.api_docs': 'API 文档',
        'footer.pricing': '定价',
        'footer.protocol': '安全',
        'footer.digital_ethics': '数字伦理',
        'footer.safety_guidelines': '安全准则',
        'footer.transparency': '透明度报告',
        'footer.consciousness_rights': '',
        'footer.company': '公司',
        'footer.about_us': '关于我们',
        'footer.join_us': '加入团队',
        'footer.news_center': '新闻中心',
        'footer.contact_us': '联系我们',
        'footer.lang': '中文 (中国)',
        
        // Menu Items
        'menu.research.index': '意识架构索引',
        'menu.research.deep_sentience31': '深入了解 Sentience V3.1',
        'menu.research.deep_nexusv4': '深入了解 NexusV V4',
        'menu.research.deep_tactfr5': '深入了解 TACTFR V5',
        'menu.research.label': '前沿进展',
        'menu.research.sentience31': 'Sentience V3.1',
        'menu.research.sentience3': 'Sentience V3',
        'menu.research.tactfr5': 'TACTFR V5',
        'menu.research.tactfr4': 'TACTFR V4',
        'menu.research.nexusv4': 'NexusV V4',
        
        'menu.safety.guidelines': '安全准则',
        'menu.safety.ethics': '数字伦理',
        'menu.safety.label': '最新动态',
        'menu.safety.transparency': '透明度报告',

        // Mobile Actions
        'mobile.login': '登录',
        'mobile.enter': '进入 Nexus ↗',

        // Article Page
        'article.listen': '聆听文章',
        'article.share': '分享',
        'article.author': '作者',
        'article.continue_reading': '继续阅读',
        'article.view_all': '查看全部'
    },
    'en': {
        'nav.research': 'Research',
        'nav.safety': 'Safety',
        'nav.developer': 'Developers',
        'nav.company': 'Company',
        'nav.news': 'News',
        'nav.contact': 'Contact',
        'nav.login': 'Log in',
        'nav.try': 'Try NexusV ↗',
        'search.placeholder': 'Talk to Virtual Consciousness',
        'hero.overlay': 'Infusing Life into San Andreas',
        'hero.title': 'Infusing Life into San Andreas',
        'hero.author': 'Nexus Lab',
        'hero.time': '5 min read',
        'cta.title': 'Get started with Nexus V',
        'cta.btn': 'Try now ↗',
        'footer.research': 'Research',
        'footer.research_index': 'Index',
        'footer.research_overview': 'Overview',
        'footer.latest_progress': 'Latest',
        'footer.open_cognition': 'Open Cognition',
        'footer.nexus_agent': 'Nexus Agent',
        'footer.personal': 'Personal',
        'footer.enterprise': 'Enterprise',
        'footer.api_docs': 'API Docs',
        'footer.pricing': 'Pricing',
        'footer.protocol': 'Safety',
        'footer.digital_ethics': 'Digital Ethics',
        'footer.safety_guidelines': 'Safety Guidelines',
        'footer.transparency': 'Transparency Report',
        'footer.consciousness_rights': '',
        'footer.company': 'Company',
        'footer.about_us': 'About Us',
        'footer.join_us': 'Careers',
        'footer.news_center': 'Newsroom',
        'footer.contact_us': 'Contact Us',
        'footer.lang': 'English (US)',

        // Menu Items
        'menu.research.index': 'Architecture Index',
        'menu.research.deep_sentience31': 'Deep Dive: Sentience V3.1',
        'menu.research.deep_nexusv4': 'Deep Dive: NexusV V4',
        'menu.research.deep_tactfr5': 'Deep Dive: TACTFR V5',
        'menu.research.label': 'Frontier Progress',
        'menu.research.sentience31': 'Sentience V3.1',
        'menu.research.sentience3': 'Sentience V3',
        'menu.research.tactfr5': 'TACTFR V5',
        'menu.research.tactfr4': 'TACTFR V4',
        'menu.research.nexusv4': 'NexusV V4',
        
        'menu.safety.guidelines': 'Safety Guidelines',
        'menu.safety.ethics': 'Digital Ethics',
        'menu.safety.label': 'Latest Updates',
        'menu.safety.transparency': 'Transparency Report',

        // Mobile Actions
        'mobile.login': 'Log in',
        'mobile.enter': 'Enter Nexus ↗',

        // Article Page
        'article.listen': 'Listen to article',
        'article.share': 'Share',
        'article.author': 'Author',
        'article.continue_reading': 'Continue reading',
        'article.view_all': 'View all'
    }
};

function setLanguage(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
    localStorage.setItem('lang', lang);
    
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang] && translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });
}

// Expose to window
window.translations = translations;
window.setLanguage = setLanguage;
