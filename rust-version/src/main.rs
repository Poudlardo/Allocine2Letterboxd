// Allocine2Letterboxd - Rust Version
// Exact mirror of JavaScript version logic

use anyhow::Result;
use clap::Parser;
use csv::WriterBuilder;
use futures::stream::{self, StreamExt};
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;
use url::Url;

/// Helper function to strip HTML tags from a string
fn strip_html_tags(s: &str) -> String {
    // Simple regex to remove HTML tags
    let re = Regex::new(r"<[^>]*>").unwrap();
    let without_tags = re.replace_all(s, "");
    // Remove "Lire plus" link text and trailing dots that Allocine appends
    // to truncated reviews
    let cleaned = without_tags.replace('\n', " ").replace('\r', " ");
    // Remove "... Lire plus" or "...                  Lire plus" artifacts
    let re_lire = Regex::new(r"\s*\.\.\.\s*Lire plus\s*").unwrap();
    let cleaned = re_lire.replace_all(&cleaned, "").to_string();
    let re_lire2 = Regex::new(r"\s*Lire plus\s*$").unwrap();
    let cleaned = re_lire2.replace_all(&cleaned, "").to_string();
    cleaned.replace("  ", " ").trim().to_string()
}

#[derive(Parser, Debug)]
#[command(name = "allocine2letterboxd")]
#[command(version = "0.1.0")]
#[command(about = "Export des films Allocine vers un CSV pour Letterboxd")]
struct Args {
    /// URL du profil Allocine (ex : https://www.allocine.fr/membre-XXXXXX/films/)
    #[arg(value_parser = validate_allocine_url)]
    url: String,

    /// Répertoire de sortie pour les fichiers CSV
    #[arg(short, long, default_value = ".")]
    output: PathBuf,

    /// Activer les logs détaillés
    #[arg(short, long)]
    verbose: bool,

    /// Activer le mode débogage (sauvegarde les pages HTML, logs détaillés)
    #[arg(short = 'D', long)]
    debug: bool,

    /// Ignorer le scraping des critiques
    #[arg(long)]
    skip_reviews: bool,

    /// Ignorer le scraping de la wishlist
    #[arg(long)]
    skip_wishlist: bool,

    /// Délai entre les requêtes en millisecondes (pour éviter le rate limiting)
    #[arg(short, long, default_value = "1500")]
    delay_ms: u64,
}

fn validate_allocine_url(url: &str) -> Result<String> {
    let re = Regex::new(r"^https://www\.allocine\.fr/membre-[A-Z0-9]+(/films/?|/critiques/films/?)?$").unwrap();
    if re.is_match(url) {
        Ok(url.to_string())
    } else {
        let normalized = normalize_url(url);
        if re.is_match(&normalized) {
            Ok(normalized)
        } else {
            Err(anyhow::anyhow!("URL Allocine invalide. Veuillez fournir une URL comme : https://www.allocine.fr/membre-XXXXXX/films/ ou https://www.allocine.fr/membre-XXXXXX/"))
        }
    }
}

fn normalize_url(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    if !url.ends_with("/films") && !url.ends_with("/films/") && !url.ends_with("/critiques/films") && !url.ends_with("/critiques/films/") {
        if let Some(caps) = Regex::new(r"membre-([A-Z0-9]+)").unwrap().captures(url) {
            return format!("https://www.allocine.fr/membre-{}/films/", &caps[1]);
        }
    }
    if url.ends_with("/films") || url.ends_with("/critiques/films") {
        return format!("{}/", url);
    }
    url.to_string()
}

/// Barre de progression unifiée couvrant tout le processus de scraping.
/// Affiche [=====>     ] 45% — Étape 2/4 : Scraping des critiques
struct ProgressBar {
    step: usize,
    total_steps: usize,
    step_label: String,
    current: usize,
    total: usize,
}

impl ProgressBar {
    fn new(total_steps: usize) -> Self {
        Self {
            step: 0,
            total_steps,
            step_label: String::new(),
            current: 0,
            total: 0,
        }
    }

    fn start_step(&mut self, step: usize, label: &str, total: usize) {
        self.step = step;
        self.step_label = label.to_string();
        self.current = 0;
        self.total = total;
        self.render();
    }

    fn update(&mut self, current: usize) {
        self.current = current;
        self.render();
    }

    fn set_total(&mut self, total: usize) {
        self.total = total;
        self.render();
    }

    fn render(&self) {
        let width = 36usize;
        let pct = if self.total > 0 {
            (self.current as f64 / self.total as f64).min(1.0)
        } else {
            0.0
        };
        let filled = (pct * width as f64).round() as usize;
        let bar: String = "█".repeat(filled) + &"░".repeat(width - filled);
        let pct_str = format!("{:3}", (pct * 100.0).round() as usize);
        let suffix = if self.total > 0 {
            format!("({}/{})", self.current, self.total)
        } else {
            format!("({}/?)", self.current)
        };
        print!(
            "\r  [{}] {}% — Étape {}/{} : {} {}   ",
            bar, pct_str, self.step, self.total_steps, self.step_label, suffix
        );
        io::stdout().flush().unwrap();
    }

    fn finish_step(&mut self) {
        // Clear the progress bar line without adding a new line
        // so the next step can reuse the same line
        self.current = self.total;
        self.render();
    }

    fn finish(&self) {
        // Clear the bar line
        print!("\r{}\r", " ".repeat(100));
        io::stdout().flush().unwrap();
    }
}

struct Selectors {
    film_title: Selector,
    film_rating: Selector,
    review_block: Selector,
    review_content: Selector,
    review_lire_plus: Selector,
    review_title: Selector,
}

impl Selectors {
    fn new() -> Self {
        Self {
            film_title: Selector::parse(".meta-title.meta-title-link").unwrap(),
            film_rating: Selector::parse(".rating-mdl").unwrap(),
            review_block: Selector::parse(".review-card").unwrap(),
            review_content: Selector::parse(".content-txt.review-card-content").unwrap(),
            review_lire_plus: Selector::parse(".blue-link.link-more").unwrap(),
            review_title: Selector::parse("a[href*='/film-']").unwrap(),
        }
    }
}

struct Scraper {
    client: Client,
    selectors: Selectors,
    delay_ms: u64,
    debug: bool,
    output_dir: PathBuf,
    progress: ProgressBar,
}

impl Scraper {
    fn new(delay_ms: u64, debug: bool, output_dir: PathBuf) -> Result<Self> {
        let client = Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(60))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()?;
        Ok(Self { client, selectors: Selectors::new(), delay_ms, debug, output_dir, progress: ProgressBar::new(4) })
    }

    /// Save HTML content to a debug file
    fn save_debug_html(&self, html: &str, filename: &str) -> Result<()> {
        if !self.debug {
            return Ok(());
        }
        let path = self.output_dir.join(filename);
        std::fs::write(&path, html)?;
        println!("  💾 HTML de débogage sauvegardé : {}", path.display());
        Ok(())
    }

    /// Log debug information
    fn debug_log(&self, message: &str) {
        if self.debug {
            eprintln!("  🔍 DÉBOGAGE : {}", message);
        }
    }

    async fn fetch_page_with_retry(&self, url: &str, max_retries: usize) -> Result<String> {
        for attempt in 0..=max_retries {
            // Add delay to avoid rate limiting
            if self.delay_ms > 0 {
                sleep(Duration::from_millis(self.delay_ms)).await;
            }
            
            let response = match self.client.get(url)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                .header("Accept-Language", "fr-FR,fr;q=0.9")
                .send()
                .await {
                Ok(r) => r,
                Err(e) => {
                    if attempt < max_retries {
                        eprintln!("  Relance {}/{} pour {} : {}", attempt + 1, max_retries, url, e);
                        sleep(Duration::from_millis(self.delay_ms * 2)).await;
                        continue;
                    }
                    return Err(e.into());
                }
            };
            
            if response.status().is_success() {
                return response.text().await.map_err(Into::into);
            }
            
            if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < max_retries {
                // Wait longer for rate limiting
                let wait_time = self.delay_ms * (attempt as u64 + 1) * 3;
                eprintln!("  Limite de débit atteinte sur {}, attente de {}ms...", url, wait_time);
                sleep(Duration::from_millis(wait_time)).await;
                continue;
            }

            // 404 is not transient — don't retry, return immediately
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Err(anyhow::anyhow!("HTTP 404 Not Found: {}", url));
            }

            if attempt < max_retries {
                eprintln!("  HTTP {} sur {}, relance...", response.status(), url);
                sleep(Duration::from_millis(self.delay_ms * 2)).await;
                continue;
            }
            
            return Err(anyhow::anyhow!("HTTP {}: {}", response.status(), url));
        }
        Err(anyhow::anyhow!("Max retries exceeded for {}", url))
    }

    async fn fetch_page(&self, url: &str) -> Result<String> {
        self.fetch_page_with_retry(url, 5).await
    }

    /// Fetch full review content from a "Lire plus" dedicated page
    async fn fetch_full_review_content(&self, url: &str) -> Result<String> {
        // Add delay before fetching to avoid rate limiting
        if self.delay_ms > 0 {
            sleep(Duration::from_millis(self.delay_ms)).await;
        }
        
        let html = self.fetch_page(url).await?;
        let document = Html::parse_document(&html);
        document.select(&self.selectors.review_content)
            .next()
            .map(|c| c.inner_html().trim().to_string())
            .ok_or_else(|| anyhow::anyhow!("Review content not found in full page"))
    }

    /// Extract the total number of pages from pagination links in HTML
    /// Uses multiple strategies to find the last page number, ordered by reliability.
    fn extract_total_pages(&self, html: &str) -> usize {
        let document = Html::parse_document(html);
        let mut max_page: usize = 0;
        
        if self.debug {
            eprintln!("\n  ===== Débogage détection de pages =====");
        }

        // Strategy 1: Look for pagination container div.pagination-item-holder
        // The last element with button and item classes contains the last page number
        if max_page == 0 {
            if let Some(pagination_div) = document.select(&Selector::parse("div.pagination-item-holder").unwrap()).next() {
                // Collect all elements with button and item classes (both a and span)
                let page_elements: Vec<_> = pagination_div.select(&Selector::parse("a[class*='button'][class*='item'], span[class*='button'][class*='item']").unwrap()).collect();
                
                if !page_elements.is_empty() {
                    // Get the last element
                    if let Some(last_elem) = page_elements.last() {
                        // Try href first (for <a> tags)
                        if let Some(href) = last_elem.value().attr("href") {
                            if let Some(page_num) = extract_page_number_from_href(href) {
                                max_page = page_num;
                                self.debug_log(&format!("Strategy 1 (div.pagination-item-holder button.item href): found page {}", page_num));
                            }
                        }
                        // Try text content as fallback (works for both <a> and <span>)
                        if max_page == 0 {
                            let html_text = last_elem.inner_html();
                            let text = html_text.trim();
                            if let Ok(num) = text.parse::<usize>() {
                                max_page = num;
                                self.debug_log(&format!("Strategy 1 (div.pagination-item-holder button.item text): found page {}", num));
                            }
                        }
                    }
                }
                
                // Fallback: try last <a> child
                if max_page == 0 {
                    if let Some(last_link) = pagination_div.select(&Selector::parse("a").unwrap()).last() {
                        if let Some(href) = last_link.value().attr("href") {
                            if let Some(page_num) = extract_page_number_from_href(href) {
                                max_page = page_num;
                                self.debug_log(&format!("Strategy 1 (div.pagination-item-holder last a): found page {}", page_num));
                            }
                        }
                        if max_page == 0 {
                            let html_text = last_link.inner_html();
                            let text = html_text.trim();
                            if let Ok(num) = text.parse::<usize>() {
                                max_page = num;
                                self.debug_log(&format!("Strategy 1 (div.pagination-item-holder last a text): found page {}", num));
                            }
                        }
                    }
                }
            }
        }

        // Strategy 2: Look for <a> immediately after <span class="button">
        // Based on user observation: <span class="button">...</span><a ...>36</a>
        if max_page == 0 {
            for link in document.select(&Selector::parse("span.button + a").unwrap()) {
                // Try href first
                if let Some(href) = link.value().attr("href") {
                    if let Some(page_num) = extract_page_number_from_href(href) {
                        if page_num > max_page {
                            max_page = page_num;
                            self.debug_log(&format!("Strategy 2 (span.button + a href): found page {}", page_num));
                        }
                    }
                }
                // Try text content
                if max_page == 0 {
                    let html_text = link.inner_html();
                    let text = html_text.trim();
                    if let Ok(num) = text.parse::<usize>() {
                        max_page = num;
                        self.debug_log(&format!("Strategy 2 (span.button + a text): found page {}", num));
                    }
                }
            }
        }

        // Strategy 3: Look for links and spans with both 'button' and 'item' classes
        // Based on user observation: <a class="xXx button button-md item" href="?page=36">36</a>
        // or <span class="... button button-md item">36</span>
        if max_page == 0 {
            for link in document.select(&Selector::parse("a[class*='button'][class*='item'], span[class*='button'][class*='item']").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if let Some(page_num) = extract_page_number_from_href(href) {
                        if page_num > max_page {
                            max_page = page_num;
                            self.debug_log(&format!("Strategy 3 (a.button.item href): found page {}", page_num));
                        }
                    }
                }
                // Also try text content
                let html_text = link.inner_html();
                let text = html_text.trim();
                if let Ok(num) = text.parse::<usize>() {
                    if num > max_page {
                        max_page = num;
                        self.debug_log(&format!("Strategy 3 (a.button.item text): found page {}", num));
                    }
                }
            }
        }

        // Strategy 4: Look for .pagination a links
        if max_page == 0 {
            for link in document.select(&Selector::parse(".pagination a").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if let Some(page_num) = extract_page_number_from_href(href) {
                        if page_num > max_page {
                            max_page = page_num;
                            self.debug_log(&format!("Strategy 4 (.pagination a href): found page {}", page_num));
                        }
                    }
                }
            }
        }

        // Strategy 5: Look for all links with page= or ?page= in href
        for link in document.select(&Selector::parse("a[href*='page=']").unwrap()) {
            if let Some(href) = link.value().attr("href") {
                if let Some(page_num) = extract_page_number_from_href(href) {
                    if page_num > max_page {
                        max_page = page_num;
                        self.debug_log(&format!("Strategy 5 (a[href*='page='] href): found page {}", page_num));
                    }
                }
            }
        }

        // Strategy 6: Fallback - look for any numeric link in film/critique URLs
        if max_page == 0 {
            for link in document.select(&Selector::parse("a[href*='/films/?page='], a[href*='/critiques/films/?page=']").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if let Some(page_num) = extract_page_number_from_href(href) {
                        if page_num > max_page {
                            max_page = page_num;
                            self.debug_log(&format!("Strategy 6 (fallback href): found page {}", page_num));
                        }
                    }
                }
            }
        }
        
        if self.debug {
            if max_page == 0 {
                eprintln!("  ⚠️  Aucun numéro de page détecté par aucune stratégie !");
            } else {
                eprintln!("  ✅ Nombre total de pages détecté : {}", max_page);
            }
        }

        max_page
    }

    async fn scrape_films(&mut self, url: &str) -> Result<Vec<Film>> {
        // Extract member ID and always use the /films/ URL, even if the input
        // was a /critiques/films/ URL
        let member_id = Regex::new(r"membre-([A-Z0-9]+)")
            .unwrap()
            .captures(url)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .ok_or_else(|| anyhow::anyhow!("Could not extract member ID from URL"))?;

        let base_url = format!("https://www.allocine.fr/membre-{}/films/", member_id);
        let mut films = Vec::new();
        let mut current_url = base_url.clone();
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut consecutive_errors = 0;
        let mut total_pages: Option<usize> = None;
        const MAX_PAGES_FALLBACK: usize = 500; // Limite de sécurité

        self.progress.start_step(1, "Scraping des films", 0);

        loop {
            // Conditions d'arrêt : URL déjà visitée, limite de sécurité, ou page vide
            if visited.contains(&current_url) {
                break;
            }
            if let Some(tp) = total_pages {
                if page > tp {
                    break; // On a dépassé le total de pages détecté
                }
            } else if page > MAX_PAGES_FALLBACK {
                eprintln!("  ⚠️ Limite de sécurité atteinte ({} pages), arrêt du scraping.", MAX_PAGES_FALLBACK);
                eprintln!("   → Le sélecteur de pagination n'a pas trouvé de nombre total de pages.");
                break;
            }

            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    // Save first page HTML for debug analysis
                    if page == 1 && self.debug {
                        self.save_debug_html(&html, "debug-page1-films.html")?;
                    }
                    
                    let document = Html::parse_document(&html);
                    
                    // Détecter le nombre total de pages sur la page 1
                    if total_pages.is_none() && page == 1 {
                        let detected_pages = self.extract_total_pages(&html);
                        self.debug_log(&format!("Extract total pages result: {}", detected_pages));
                        if detected_pages > 0 {
                            total_pages = Some(detected_pages);
                            self.progress.set_total(detected_pages);
                        } else {
                            eprintln!("  ℹ️ Nombre de pages non détecté, utilisation du fallback...");
                        }
                    }

                    let page_films = self.extract_films(&document);
                    
                    // Si aucun film trouvé sur cette page, on a atteint la fin
                    if page_films.is_empty() {
                        break;
                    }
                    
                    films.extend(page_films);
                    self.progress.update(page);
                    consecutive_errors = 0;

                    // Passer à la page suivante
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                    } else {
                        // Construire l'URL manuellement
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                    }
                    page += 1;
                }
                Err(e) => {
                    eprintln!("  ❌ Erreur sur la page {} : {}", page, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= 2 {
                        eprintln!("  Trop d'erreurs consécutives, arrêt.");
                        break;
                    }
                    // Essayer la page suivante
                    if current_url.contains("?page=") {
                        let base: Vec<&str> = current_url.split("?page=").collect();
                        current_url = format!("{}?page={}", base[0], page + 1);
                    } else {
                        current_url = format!("{}?page={}", current_url, page + 1);
                    }
                    page += 1;
                }
            }
        }
        self.progress.finish_step();
        Ok(films)
    }

    fn extract_films(&self, document: &Html) -> Vec<Film> {
        let mut films = Vec::new();
        
        // Primary selector - try multiple selectors
        let film_selectors = vec![
            Selector::parse(".userprofile-section .card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            Selector::parse(".section-films .card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            Selector::parse(".card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
        ];
        
        for selector in &film_selectors {
            for el in document.select(selector) {
                let title = el.select(&self.selectors.film_title)
                    .next()
                    .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                    .or_else(|| {
                        el.select(&self.selectors.film_title)
                            .next()
                            .map(|t| strip_html_tags(&t.inner_html()).trim().to_string())
                    });
                
                let rating = el.select(&self.selectors.film_rating)
                    .next()
                    .and_then(|r| r.value().attr("class"))
                    .and_then(|c| {
                        let re = Regex::new(r"n(\d{2})").unwrap();
                        re.captures(c).and_then(|cap| cap.get(1)).map(|m| m.as_str())
                    })
                    .map(|s| format!("{}.{}", &s[0..1], &s[1..2]))
                    .unwrap_or_default();

                if let Some(title) = title {
                    films.push(Film { title, rating });
                }
            }
            
            // If we found films with this selector, stop trying others
            if !films.is_empty() {
                break;
            }
        }
        
        // Fallback selector (like JS version)
        if films.is_empty() {
            for el in document.select(&Selector::parse(".card").unwrap()) {
                let title = el.select(&Selector::parse(".meta-title-link, [class*=\"title\"]").unwrap())
                    .next()
                    .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                    .or_else(|| {
                        el.select(&Selector::parse(".meta-title-link, [class*=\"title\"]").unwrap())
                            .next()
                            .map(|t| strip_html_tags(&t.inner_html()).trim().to_string())
                    });
                
                let rating = el.select(&Selector::parse(".rating-mdl, [class*=\"rating\"]").unwrap())
                    .next()
                    .and_then(|r| r.value().attr("class"))
                    .and_then(|c| {
                        let re = Regex::new(r"n(\d{2})").unwrap();
                        re.captures(c).and_then(|cap| cap.get(1)).map(|m| m.as_str())
                    })
                    .map(|s| format!("{}.{}", &s[0..1], &s[1..2]))
                    .unwrap_or_default();

                if let Some(title) = title {
                    films.push(Film { title, rating });
                }
            }
        }
        
        films
    }

    fn find_next_page(&self, document: &Html, current_url: &str) -> Option<String> {
        // First, try to find a link with "Page suivante" or "Suivant" or "Next" in title or text
        for link in document.select(&Selector::parse("a").unwrap()) {
            let title_attr = link.value().attr("title").map(|s| s.to_lowercase());
            let text = link.inner_html().to_lowercase();
            
            if let Some(title) = title_attr {
                if title.contains("suivant") || title.contains("next") || title.contains("page suivante") {
                    if let Some(href) = link.value().attr("href") {
                        return resolve_url(href, current_url);
                    }
                }
            }
            
            if text.contains("suivant") || text.contains("next") || text.contains("page suivante") {
                if let Some(href) = link.value().attr("href") {
                    return resolve_url(href, current_url);
                }
            }
        }
        
        // Try to find pagination links with ?page= parameter
        // Look for the highest page number in pagination
        let mut max_page: usize = 0;
        let current_page_num = extract_page_number(current_url);
        
        for link in document.select(&Selector::parse("a[href*='?page=']").unwrap()) {
            if let Some(href) = link.value().attr("href") {
                if let Some(page_num) = extract_page_number_from_href(href) {
                    if page_num > max_page {
                        max_page = page_num;
                    }
                }
            }
        }
        
        // If we found pagination, check if there's a next page
        if max_page > 0 {
            // Try to find a link that points to the next page
            for link in document.select(&Selector::parse("a[href*='?page=']").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if let Some(page_num) = extract_page_number_from_href(href) {
                        if page_num == current_page_num + 1 {
                            return resolve_url(href, current_url);
                        }
                    }
                }
            }
            
            // If no direct link found but max_page > current_page, construct next page
            if max_page > current_page_num {
                let base = current_url.split("?page=").next().unwrap_or(current_url);
                return Some(format!("{}?page={}", base, current_page_num + 1));
            }
        }
        
        None
    }

    async fn scrape_reviews(&mut self, url: &str) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        
        // Construct reviews URL: replace /films/ with /critiques/films/
        // If the URL already contains /critiques/films/, use it as-is
        let reviews_url = if url.contains("/critiques/films/") || url.contains("/critiques/films") {
            // Already a reviews URL, just ensure it ends with /
            let trimmed = url.trim().trim_end_matches('/');
            if trimmed.ends_with("/critiques/films") {
                format!("{}/", trimmed)
            } else {
                url.to_string()
            }
        } else if url.ends_with("/films/") {
            url.replace("/films/", "/critiques/films/")
        } else if url.ends_with("/films") {
            url.replace("/films", "/critiques/films/")
        } else if url.ends_with('/') {
            format!("{}critiques/films/", url)
        } else {
            format!("{}/critiques/films/", url)
        };
        
        let mut current_url = reviews_url;
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut consecutive_errors = 0;
        let mut total_pages: Option<usize> = None;
        const MAX_PAGES_FALLBACK: usize = 500;

        self.progress.start_step(2, "Scraping des critiques", 0);

        loop {
            // Conditions d'arret : URL deja visitee, limite de securite, ou page vide
            if visited.contains(&current_url) {
                break;
            }
            if let Some(tp) = total_pages {
                if page > tp {
                    break;
                }
            } else if page > MAX_PAGES_FALLBACK {
                eprintln!("  ⚠️ Limite de sécurité atteinte ({} pages), arrêt du scraping des critiques.", MAX_PAGES_FALLBACK);
                eprintln!("   → Le selecteur de pagination n'a pas trouve de nombre total de pages.");
                break;
            }

            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    // Save first page HTML for debug analysis
                    if page == 1 && self.debug {
                        self.save_debug_html(&html, "debug-page1-reviews.html")?;
                    }
                    
                    let document = Html::parse_document(&html);
                    
                    // Detecter le nombre total de pages sur la page 1
                    if total_pages.is_none() && page == 1 {
                        let detected_pages = self.extract_total_pages(&html);
                        self.debug_log(&format!("Extract total pages result: {}", detected_pages));
                        if detected_pages > 0 {
                            total_pages = Some(detected_pages);
                            self.progress.set_total(detected_pages);
                        } else {
                            eprintln!("  ℹ️ Nombre de pages non détecté, utilisation du fallback...");
                        }
                    }
                    
                    // Check if there are any review blocks
                    let review_blocks = document.select(&self.selectors.review_block).count();
                    if review_blocks == 0 {
                        break;
                    }
                    
                    let page_reviews = self.extract_reviews(&document, &current_url).await?;
                    
                    if page_reviews.is_empty() {
                        break;
                    }
                    
                    reviews.extend(page_reviews);
                    self.progress.update(page);
                    
                    consecutive_errors = 0;

                    // Find next page
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                    } else {
                        // No next page link found, try to construct next page URL manually
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                    }
                    page += 1;
                }
                Err(e) => {
                    eprintln!("  ❌ Erreur sur la page {} : {}", page, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= 5 {
                        eprintln!("  Trop d'erreurs consécutives, arrêt.");
                        break;
                    }
                    // Essayer la page suivante
                    if current_url.contains("?page=") {
                        let base: Vec<&str> = current_url.split("?page=").collect();
                        current_url = format!("{}?page={}", base[0], page + 1);
                    } else {
                        current_url = format!("{}?page={}", current_url, page + 1);
                    }
                    page += 1;
                }
            }
        }
        self.progress.finish_step();
        Ok(reviews)
    }

    async fn extract_reviews(&self, document: &Html, base_url: &str) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        
        // Extract film titles and initial review texts from all blocks
        let mut review_blocks: Vec<(String, String, Option<String>)> = Vec::new();
        
        for block in document.select(&self.selectors.review_block) {
            // Extract film title
            let mut title = String::new();
            
            for link in block.select(&Selector::parse("a[href*='/film-']").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if href.contains("/film-") && !href.contains("critique") {
                        let text = strip_html_tags(&link.inner_html());
                        if !text.is_empty() {
                            title = text;
                            break;
                        }
                    }
                }
            }
            
            if title.is_empty() {
                for link in block.select(&self.selectors.review_title) {
                    let text = strip_html_tags(&link.inner_html());
                    if !text.is_empty() && !text.chars().all(|c| c.is_numeric() || c.is_whitespace()) {
                        title = text;
                        break;
                    }
                }
            }
            
            if title.is_empty() {
                if let Some(el) = block.select(&Selector::parse(".review-card-title").unwrap()).next() {
                    title = strip_html_tags(&el.inner_html());
                }
            }
            
            if title.is_empty() {
                for link in block.select(&Selector::parse("a").unwrap()) {
                    let text = strip_html_tags(&link.inner_html());
                    if !text.is_empty() && text != "Lire plus" && text != "Read more" && text != "..." && !text.contains("page") {
                        title = text;
                        break;
                    }
                }
            }
            
            if title.is_empty() {
                title = "UNKNOWN_FILM".to_string();
            }
            
            // Extract initial review text
            let text = block.select(&self.selectors.review_content)
                .next()
                .map(|c| c.inner_html().trim().to_string())
                .unwrap_or_default();
            
            // Check for "Lire plus" link
            let more_url = block.select(&self.selectors.review_lire_plus)
                .next()
                .and_then(|l| l.value().attr("href"))
                .and_then(|h| resolve_url(h, base_url));
            
            review_blocks.push((title, text, more_url));
        }
        
        // Fetch full reviews in parallel for all "Lire plus" links
        // Limit concurrency to avoid rate limiting - use 3 parallel requests
        let concurrency_limit = 3;
        
        // Clone review_blocks for the stream since it will be consumed
        let blocks_for_stream = review_blocks.clone();
        
        let full_texts: Vec<String> = stream::iter(blocks_for_stream)
            .map(|(title, text, more_url)| async move {
                if let Some(url) = more_url {
                    // Try to fetch full review
                    match self.fetch_full_review_content(&url).await {
                        Ok(full_text) => full_text,
                        Err(e) => {
                            eprintln!("  ⚠️ Échec de la récupération de la critique complète pour '{}' : {}", title, e);
                            text
                        }
                    }
                } else {
                    text
                }
            })
            .buffer_unordered(concurrency_limit)
            .collect()
            .await;
        
        // Pair full texts with titles and create reviews
        for ((title, _, _), full_text) in review_blocks.into_iter().zip(full_texts) {
            let cleaned_text = strip_html_tags(&full_text);
            reviews.push(Review { title, review: cleaned_text });
        }
        
        Ok(reviews)
    }

    async fn scrape_wishlist(&mut self, url: &str) -> Result<Vec<WishlistItem>> {
        let mut items = Vec::new();

        // Extract member ID and build the correct wishlist URL
        let member_id = Regex::new(r"membre-([A-Z0-9]+)")
            .unwrap()
            .captures(url)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .ok_or_else(|| anyhow::anyhow!("Could not extract member ID from URL"))?;

        let wishlist_url = format!(
            "https://www.allocine.fr/membre-{}/films/envie-de-voir/",
            member_id
        );
        let mut current_url = wishlist_url;
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut total_pages: Option<usize> = None;
        const MAX_PAGES_FALLBACK: usize = 500;

        self.progress.start_step(3, "Scraping de la wishlist", 0);

        loop {
            // Conditions d'arret : URL deja visitee ou limite de securite
            if visited.contains(&current_url) {
                break;
            }
            if let Some(tp) = total_pages {
                if page > tp {
                    break;
                }
            } else if page > MAX_PAGES_FALLBACK {
                eprintln!("  ⚠️ Limite de sécurité atteinte ({} pages), arrêt du scraping de la wishlist.", MAX_PAGES_FALLBACK);
                eprintln!("   → Le selecteur de pagination n'a pas trouve de nombre total de pages.");
                break;
            }

            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    // Save first page HTML for debug analysis
                    if page == 1 && self.debug {
                        self.save_debug_html(&html, "debug-page1-wishlist.html")?;
                    }
                    
                    let document = Html::parse_document(&html);
                    
                    // Detecter le nombre total de pages sur la page 1
                    if total_pages.is_none() && page == 1 {
                        let detected_pages = self.extract_total_pages(&html);
                        self.debug_log(&format!("Extract total pages result: {}", detected_pages));
                        if detected_pages > 0 {
                            total_pages = Some(detected_pages);
                            self.progress.set_total(detected_pages);
                        } else {
                            // If no pagination detected, check if there are any items on this page
                            let page_items = self.extract_wishlist(&document);
                            if page_items.is_empty() {
                                // No pagination and no items = user has no wishlist
                                eprintln!("  ℹ️ Aucune wishlist trouvée (wishlist vide ou désactivée).");
                                break;
                            } else {
                                // No pagination but items exist = single page
                                total_pages = Some(1);
                                self.progress.set_total(1);
                            }
                        }
                    }
                    
                    let page_items = self.extract_wishlist(&document);
                    if page_items.is_empty() {
                        break;
                    }
                    
                    items.extend(page_items);
                    self.progress.update(page);

                    // Find next page
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                    } else {
                        // No next page link found, try to construct next page URL manually
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                    }
                    page += 1;
                }
                Err(e) => {
                    if page == 1 && e.to_string().contains("404") {
                        // Wishlist page doesn't exist - user has no wishlist
                        eprintln!("  ℹ️ Aucune wishlist trouvée (la page de wishlist n'existe pas).");
                    } else {
                        eprintln!("  ❌ Erreur sur la page {} : {}", page, e);
                    }
                    break;
                }
            }
        }
        self.progress.finish_step();
        Ok(items)
    }

    fn extract_wishlist(&self, document: &Html) -> Vec<WishlistItem> {
        // Use the same selectors as films
        let film_selectors = vec![
            Selector::parse(".userprofile-section .card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            Selector::parse(".section-films .card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            Selector::parse(".card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
        ];
        
        let mut items = Vec::new();
        for selector in &film_selectors {
            for el in document.select(selector) {
                let title = el.select(&self.selectors.film_title)
                    .next()
                    .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                    .or_else(|| {
                        el.select(&self.selectors.film_title)
                            .next()
                            .map(|t| strip_html_tags(&t.inner_html()).trim().to_string())
                    });
                
                if let Some(title) = title {
                    items.push(WishlistItem { title });
                }
            }
            
            // If we found items with this selector, stop trying others
            if !items.is_empty() {
                break;
            }
        }
        
        // Fallback
        if items.is_empty() {
            for el in document.select(&Selector::parse(".card").unwrap()) {
                let title = el.select(&Selector::parse(".meta-title-link, [class*=\"title\"]").unwrap())
                    .next()
                    .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                    .or_else(|| {
                        el.select(&Selector::parse(".meta-title-link, [class*=\"title\"]").unwrap())
                            .next()
                            .map(|t| strip_html_tags(&t.inner_html()).trim().to_string())
                    });
                
                if let Some(title) = title {
                    items.push(WishlistItem { title });
                }
            }
        }
        
        items
    }
}

fn resolve_url(href: &str, base_url: &str) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        Some(href.to_string())
    } else {
        Url::parse(base_url).ok().and_then(|base| base.join(href).ok()).map(|u| u.to_string())
    }
}

fn extract_page_number(url: &str) -> usize {
    if let Some(pos) = url.find("?page=") {
        let page_str = &url[pos + 6..];
        if let Some(amp_pos) = page_str.find('&') {
            page_str[..amp_pos].parse().unwrap_or(1)
        } else {
            page_str.parse().unwrap_or(1)
        }
    } else {
        1
    }
}

fn extract_page_number_from_href(href: &str) -> Option<usize> {
    if let Some(pos) = href.find("?page=") {
        let page_str = &href[pos + 6..];
        if let Some(amp_pos) = page_str.find('&') {
            page_str[..amp_pos].parse().ok()
        } else {
            page_str.parse().ok()
        }
    } else if let Some(pos) = href.find("page=") {
        let page_str = &href[pos + 5..];
        if let Some(amp_pos) = page_str.find('&') {
            page_str[..amp_pos].parse().ok()
        } else {
            page_str.parse().ok()
        }
    } else {
        None
    }
}

fn normalize_title(title: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    // Remove special characters and normalize
    let normalized: String = title.nfkd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect();
    // Remove punctuation and special chars except spaces and basic punctuation
    let cleaned = normalized.replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace() && c != ':' && c != '-' && c != '(' && c != ')' && c != '&', "");
    cleaned.to_lowercase().trim().to_string()
}

fn merge_data(films: Vec<Film>, reviews: Vec<Review>) -> Vec<ExportEntry> {
    // Create a map from normalized film title to review
    let mut review_map: HashMap<String, String> = HashMap::new();
    
    for review in &reviews {
        let norm_title = normalize_title(&review.title);
        // Only insert if not already present (first review for this title wins)
        // But if the title is UNKNOWN_FILM, skip it
        if norm_title != normalize_title("UNKNOWN_FILM") {
            review_map.entry(norm_title).or_insert_with(|| review.review.clone());
        }
    }
    
    // Now merge
    let mut entries = Vec::with_capacity(films.len());
    for film in &films {
        let norm_title = normalize_title(&film.title);
        let review = review_map.get(&norm_title).cloned().unwrap_or_default();
        entries.push(ExportEntry {
            title: film.title.clone(),
            rating10: convert_rating(&film.rating),
            review: clean_review(&review),
        });
    }
    
    entries
}

#[derive(Debug, Clone, Serialize)]
struct Film {
    title: String,
    rating: String,
}

#[derive(Debug, Clone, Serialize)]
struct Review {
    title: String,
    review: String,
}

#[derive(Debug, Clone, Serialize)]
struct WishlistItem {
    title: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExportEntry {
    title: String,
    #[serde(rename = "Rating10")]
    rating10: String,
    review: String,
}

/// Convert a 0.5–5.0 rating (Allocine stars) to Letterboxd's 1–10 scale.
/// "2.5" → "5", "4.0" → "8", "5.0" → "10", "" → ""
fn convert_rating(rating: &str) -> String {
    if rating.is_empty() {
        return String::new();
    }
    if let Ok(r) = rating.parse::<f64>() {
        let converted = (r * 2.0).round() as i32;
        return converted.to_string();
    }
    rating.to_string()
}

/// Clean review text: remove "... Lire plus" truncation artifacts
/// and excessive whitespace.
fn clean_review(text: &str) -> String {
    let mut cleaned = text.to_string();
    // Remove the truncation marker and anything after it
    // Pattern: "...                  Lire plus" or "... Lire plus"
    let re = Regex::new(r"\s*\.\.\.\s*Lire plus\s*").unwrap();
    cleaned = re.replace(&cleaned, "").to_string();
    // Also handle standalone "... Lire plus" without leading dots
    let re2 = Regex::new(r"\s*Lire plus\s*$").unwrap();
    cleaned = re2.replace(&cleaned, "").to_string();
    // Trim trailing whitespace and dots
    cleaned.trim().trim_end_matches('.').trim().to_string()
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    if args.verbose {
        std::env::set_var("RUST_LOG", "info");
    }

    println!("A2L - Rust Version");
    println!("===================");
    println!("");

    if !args.output.exists() {
        std::fs::create_dir_all(&args.output)?;
    }

    let mut scraper = Scraper::new(args.delay_ms, args.debug, args.output.clone())?;
    
    if args.debug {
        println!("Mode débogage activé - les pages HTML seront sauvegardées pour analyse");
    }

    // Scrape films
    let films = scraper.scrape_films(&args.url).await?;

    // Scrape reviews
    let reviews = if args.skip_reviews {
        Vec::new()
    } else {
        scraper.scrape_reviews(&args.url).await?
    };

    // Scrape wishlist
    let wishlist = if args.skip_wishlist {
        Vec::new()
    } else {
        scraper.scrape_wishlist(&args.url).await?
    };

    // Export
    scraper.progress.start_step(4, "Export CSV", 2);

    // Export films
    let mut films_split = false;
    let mut films_count = 0;
    let mut films_parts: Vec<(std::path::PathBuf, usize)> = Vec::new();
    if !films.is_empty() {
        let entries = if !reviews.is_empty() {
            merge_data(films, reviews)
        } else {
            films.into_iter().map(|f| ExportEntry {
                title: f.title,
                rating10: convert_rating(&f.rating),
                review: String::new(),
            }).collect()
        };
        films_count = entries.len();

        // Split into parts if too large for Letterboxd's import limit
        const MAX_ROWS_PER_FILE: usize = 2500;
        if entries.len() > MAX_ROWS_PER_FILE {
            films_split = true;
            let total_parts = (entries.len() + MAX_ROWS_PER_FILE - 1) / MAX_ROWS_PER_FILE;
            for (part_idx, chunk) in entries.chunks(MAX_ROWS_PER_FILE).enumerate() {
                let part_num = part_idx + 1;
                let part_path = args.output.join(format!("allocine-films-part{}.csv", part_num));
                let mut part_writer = WriterBuilder::new().has_headers(false).from_writer(File::create(&part_path)?);
                part_writer.write_record(&["Title", "Rating10", "Review"])?;
                for entry in chunk {
                    part_writer.serialize(entry)?;
                }
                part_writer.flush()?;
                films_parts.push((part_path, chunk.len()));
            }
            let _ = total_parts; // used for messaging below
        } else {
            let path = args.output.join("allocine-films.csv");
            let mut writer = WriterBuilder::new().has_headers(false).from_writer(File::create(&path)?);
            writer.write_record(&["Title", "Rating10", "Review"])?;
            for entry in &entries {
                writer.serialize(entry)?;
            }
            writer.flush()?;
            films_parts.push((path, entries.len()));
        }
    }
    scraper.progress.update(1);

    // Export wishlist
    let wishlist_path = if !wishlist.is_empty() {
        let path = args.output.join("allocine-films-a-voir.csv");
        let mut writer = WriterBuilder::new().has_headers(false).from_writer(File::create(&path)?);
        writer.write_record(&["Title"])?;
        for item in &wishlist {
            writer.serialize(item)?;
        }
        writer.flush()?;
        Some(path)
    } else {
        None
    };
    scraper.progress.update(2);

    // Effacer la barre de progression
    scraper.progress.finish();

    // Afficher le récapitulatif
    println!("  Films : {}", films_count);
    if films_split {
        println!("    Découpé en {} fichiers (limite de 2500 lignes par Letterboxd) :", films_parts.len());
        for (i, (p, n)) in films_parts.iter().enumerate() {
            println!("      Fichier {} : {} lignes — {}", i + 1, n, p.display());
        }
        println!("    Importez chaque fichier séparément sur https://letterboxd.com/import/import/");
    } else if !films_parts.is_empty() {
        println!("    Exporté vers {}", films_parts[0].0.display());
    }
    if let Some(ref wp) = wishlist_path {
        println!("  Wishlist : {} films — {}", wishlist.len(), wp.display());
    }
    println!("");
    println!("Terminé !");
    Ok(())
}
