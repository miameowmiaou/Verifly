const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const natural = require('natural');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Load reliable sources
let reliableSources = [];
try {
    const reliableSourcesPath = path.join(__dirname, 'reliable_sources.json');
    reliableSources = JSON.parse(fs.readFileSync(reliableSourcesPath, 'utf8'));
} catch (error) {
    console.error('Error loading reliable_sources.json:', error);
}

// Configuration de l'API Google Custom Search
const customSearch = google.customsearch('v1');
const API_KEY = 'AIzaSyDE4JQlAiYbgBl9M9lYEOFzvpyANeBGpgE';
const SEARCH_ENGINE_ID = '04fff3ce9794b4b7f';

const LOG_FILE = path.join(__dirname, 'analysis_logs.json');

// Fonction pour logger les analyses
function logAnalysis(data) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        inputUrl: data.inputUrl,
        analysis: {
            keywords: {
                extracted: data.keywords,
                source: "titre de l'article"
            },
            googleSearchQuery: data.googleSearchQuery,
            reliabilityScore: data.reliabilityScore,
            reliabilityScoreDetails: data.reliabilityScoreDetails, // Ajout des détails du score
            similarArticles: data.similarArticles.map(article => ({
                title: article.title,
                url: article.url,
                score: article.score,
                matchedKeywords: data.keywords.filter(keyword => 
                    article.title.toLowerCase().includes(keyword.toLowerCase())
                )
            }))
        }
    };

    let logs = [];
    try {
        if (fs.existsSync(LOG_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Erreur lors de la lecture des logs:', error);
    }

    logs.push(logEntry);

    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
        console.log('Analyse enregistrée :', {
            url: logEntry.inputUrl,
            keywords: logEntry.analysis.keywords,
            googleSearchQuery: logEntry.analysis.googleSearchQuery, // Affichage dans la console
            timestamp: logEntry.timestamp
        });
    } catch (error) {
        console.error('Erreur lors de l\'écriture des logs:', error);
    }
}

// Fonction pour extraire les mots-clés d'un texte
function extractKeywords(text, url) {
    // Extraction du titre depuis l'URL
    const urlTitle = decodeURIComponent(url)
        .split('/')
        .pop()
        .split('_')[0]  // Prend la partie avant le premier underscore
        .replace(/-/g, ' ');

    const tokenizer = new natural.WordTokenizer();
    
    // Tokenisation du titre de l'URL et du texte
    const urlTokens = tokenizer.tokenize(urlTitle.toLowerCase());
    const textTokens = tokenizer.tokenize(text.toLowerCase());
    
    // Suppression des mots vides
    const stopwords = new Set([
        'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'mais', 'donc',
        'car', 'si', 'que', 'qui', 'quoi', 'dont', 'où', 'quand', 'comment',
        'pourquoi', 'quel', 'quelle', 'quels', 'quelles', 'de', 'du', 'dans',
        'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'en', 'vers', 'chez',
        'html', 'php', 'aspx', 'htm', 'www', 'http', 'https', 'com',
        'article', 'articles', 'page', 'pages', 'a', 'b', 'c', 'd', 'e',
         'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r',
         's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'peut', 'pas'
    ]);

    // Filtrage des tokens de l'URL
    const filteredUrlTokens = urlTokens.filter(token => 
        !stopwords.has(token) && 
        token.length > 2 && 
        !/^\d+$/.test(token)
    );

    // Filtrage des tokens du texte
    const filteredTextTokens = textTokens.filter(token => !stopwords.has(token));
    
    // Calcul de la fréquence des mots du texte
    const frequency = {};
    filteredTextTokens.forEach(token => {
        frequency[token] = (frequency[token] || 0) + 1;
    });

    // Ajout des mots de l'URL avec une fréquence élevée pour les prioriser
    filteredUrlTokens.forEach(token => {
        frequency[token] = (frequency[token] || 0) + 10;
    });
    
    // Sélection des mots-clés les plus fréquents
    return Object.entries(frequency)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([word]) => word);
}

// Fonction pour calculer le score de fiabilité
async function calculateReliabilityScore(url, content) {
    let score = 0; 
    const scoreBreakdown = { 
        baseScore: 0,
        reliableSourceBonus: 0,
        domainAuthority: 0,
        contentLength: 0,
        references: 0,
        datePresence: 0,
        authorPresence: 0
    };

    // Vérifier si le domaine est dans reliable_sources.json
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname;
        if (domain.startsWith('www.')) {
            domain = domain.substring(4);
        }

        if (reliableSources.includes(domain)) {
            score += 50;
            scoreBreakdown.reliableSourceBonus = 50;
        }
    } catch (e) {
        console.error('Erreur lors de l\'extraction du domaine:', e);
    }

    // Critères de fiabilité
    const criteria = {
        domainAuthority: async () => {
            const trustedDomains = ['.edu', '.gov', '.org'];
            const domain = new URL(url).hostname;
            if (trustedDomains.some(td => domain.endsWith(td))) {
                score += 15;
                scoreBreakdown.domainAuthority = 15;
            }
        },

        contentLength: () => {
            const wordCount = content.split(/\s+/).length;
            if (wordCount > 1000) {
                score += 5;
                scoreBreakdown.contentLength = 5;
            } else if (wordCount > 500) {
                score += 2;
                scoreBreakdown.contentLength = 2;
            }
        },

        references: () => {
            const $ = cheerio.load(content);
            const linkCount = $('a').length;
            if (linkCount > 10) {
                score += 5;
                scoreBreakdown.references = 5;
            } else if (linkCount > 2) {
                score += 2;
                scoreBreakdown.references = 2;
            }
        },

        datePresence: () => {
            const hasDate = /\d{4}[-/]\d{2}[-/]\d{2}/.test(content);
            if (hasDate) {
                score += 5;
                scoreBreakdown.datePresence = 5;
            }
        },

        authorPresence: () => {
            const $ = cheerio.load(content);
            const hasAuthor = $('*:contains(\"author\")').length > 0;
            if (hasAuthor) {
                score += 5;
                scoreBreakdown.authorPresence = 5;
            }
        }
    };

    // Application des critères
    await Promise.all(Object.values(criteria).map(criterion => criterion()));

    // Normalisation du score entre 0 et 100
    const finalScore = Math.min(Math.max(score, 0), 100);

    return { finalScore, scoreBreakdown };
}

// Fonction pour effectuer une recherche Google
async function searchSimilarArticles(keywords) {
    try {
        const response = await customSearch.cse.list({
            auth: API_KEY,
            cx: SEARCH_ENGINE_ID,
            q: keywords.join(' '),
            num: 10
        });

        let similarArticles = response.data.items.map(item => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet
        }));

        // Limiter à 5 articles après le filtrage
        return similarArticles.slice(0, 5);

    } catch (error) {
        console.error('Erreur lors de la recherche Google:', error);
        return [];
    }
}

// Route pour analyser l'article
app.post('/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(url);

        const content = await page.evaluate(() => {
            return {
                text: document.body.innerText,
                html: document.body.innerHTML
            };
        });

        const extractedKeywords = extractKeywords(content.text, url);
        const similarArticles = await searchSimilarArticles(extractedKeywords);
        const { finalScore, scoreBreakdown } = await calculateReliabilityScore(url, content.html); // Récupération des détails

        logAnalysis({
            inputUrl: url,
            keywords: extractedKeywords,
            googleSearchQuery: extractedKeywords.slice(0, 5).join(' '),
            reliabilityScore: finalScore,
            reliabilityScoreDetails: scoreBreakdown, // Passage des détails du score
            similarArticles: similarArticles
        });

        res.json({
            keywords: extractedKeywords,
            similarArticles: similarArticles,
            reliabilityScore: finalScore,
            reliabilityScoreDetails: scoreBreakdown // Renvoi des détails du score au client
        });

        await browser.close();
    } catch (error) {
        console.error('Erreur lors de l\'analyse de l\'article:', error);
        res.status(500).json({ error: 'Erreur lors de l\'analyse de l\'article.' });
    }
});

app.get('/logs', (req, res) => {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
            res.json(logs);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Erreur lors de la lecture des logs:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
