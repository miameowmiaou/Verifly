function getColorForScore(score) {
    const hue = (score / 100) * 120; 
    return `hsl(${hue}, 100%, 50%)`;
}

async function analyzeArticle() {
    const urlInput = document.getElementById('articleUrl');
    const resultsDiv = document.getElementById('results');
    const loadingDiv = document.getElementById('loading');
    const scoreSpan = document.getElementById('score');
    const scoreCircle = document.querySelector('.score-circle');
    const similarArticlesList = document.getElementById('similarArticlesList');

    if (!urlInput.value) {
        alert('Please enter an article URL');
        return;
    }

    // Show loading, hide results
    loadingDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    
    try {
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: urlInput.value })
        });

        const data = await response.json();
        
        if (response.ok) {
            // Update reliability score
            scoreSpan.textContent = data.reliabilityScore;
            scoreCircle.style.backgroundColor = getColorForScore(data.reliabilityScore); // Apply color

            // Update similar articles
            similarArticlesList.innerHTML = data.similarArticles
                .map(article => `
                    <div class="article-item">
                        <a href="${article.url}" class="article-title" target="_blank">
                            ${article.title}
                        </a>
                    </div>
                `)
                .join('');

            // Show results
            resultsDiv.classList.remove('hidden');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        alert('Error analyzing article: ' + error.message);
    } finally {
        loadingDiv.classList.add('hidden');
    }
}