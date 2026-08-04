// Allocine2Letterboxd - Rust Version
// Exact mirror of JavaScript version logic

use anyhow::Result;
use clap::Parser;
use csv::Writer;
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
    // Clean up multiple spaces and trim
    without_tags.replace('\n', " ").replace('\r', " ").replace("  ", " ").trim().to_string()
}

#[derive(Parser, Debug)]
#[command(name = "allocine2letterboxd")]
#[command(version = "0.1.0")]
#[command(about = "Export Allocine films to CSV for Letterboxd")]
struct Args {
    #[arg(value_parser = validate_allocine_url)]
    url: String,

    #[arg(short, long, default_value = ".")]
    output: PathBuf,

    #[arg(short, long)]
    verbose: bool,

    #[arg(long)]
    skip_reviews: bool,

    #[arg(long)]
    skip_wishlist: bool,

    #[arg(short, long, default_value = "1500")]
    delay_ms: u64,
}

fn validate_allocine_url(url: &str) -> Result<String> {
    let re = Regex::new(r"^https://www\.allocine\.fr/membre-[A-Z0-9]+(/films/?)?$").unwrap();
    if re.is_match(url) {
        Ok(url.to_string())
    } else {
        let normalized = normalize_url(url);
        if re.is_match(&normalized) {
            Ok(normalized)
        } else {
            Err(anyhow::anyhow!("Invalid Allocine URL"))
        }
    }
}

fn normalize_url(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    if !url.ends_with("/films") && !url.ends_with("/films/") {
        if let Some(caps) = Regex::new(r"membre-([A-Z0-9]+)").unwrap().captures(url) {
            return format!("https://www.allocine.fr/membre-{}/films/", &caps[1]);
        }
    }
    if url.ends_with("/films") {
        return format!("{}/", url);
    }
    url.to_string()
}

fn print_progress(current: usize, message: &str) {
    print!("\r{}... {}", message, current);
    io::stdout().flush().unwrap();
}

fn clear_progress() {
    print!("\r{}\n", " ".repeat(80));
}

struct Selectors {
    film_item: Selector,
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
            // Try multiple selectors for film items - from most specific to least specific
            film_item: Selector::parse(".userprofile-section .card.entity-card-simple.userprofile-entity-card-simple, .section-films .card.entity-card-simple.userprofile-entity-card-simple, .card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            film_title: Selector::parse(".meta-title.meta-title-link").unwrap(),
            film_rating: Selector::parse(".rating-mdl").unwrap(),
            review_block: Selector::parse(".review-card").unwrap(),
            review_content: Selector::parse(".content-txt.review-card-content").unwrap(),
            review_lire_plus: Selector::parse(".blue-link.link-more").unwrap(),
            review_title: Selector::parse("a.xXx").unwrap(),
        }
    }
}

struct Scraper {
    client: Client,
    selectors: Selectors,
    delay_ms: u64,
}

impl Scraper {
    fn new(delay_ms: u64) -> Result<Self> {
        let client = Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(60))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()?;
        Ok(Self { client, selectors: Selectors::new(), delay_ms })
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
                        eprintln!("  Retry {}/{} for {}: {}", attempt + 1, max_retries, url, e);
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
                eprintln!("  Rate limited on {}, waiting {}ms...", url, wait_time);
                sleep(Duration::from_millis(wait_time)).await;
                continue;
            }
            
            if attempt < max_retries {
                eprintln!("  HTTP {} on {}, retrying...", response.status(), url);
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

    async fn scrape_films(&self, url: &str) -> Result<Vec<Film>> {
        let mut films = Vec::new();
        let mut current_url = normalize_url(url);
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut consecutive_errors = 0;
        let mut consecutive_empty_pages = 0;

        print_progress(films.len(), "Scraping films");

        loop {
            if visited.contains(&current_url) || page > 100 || consecutive_empty_pages >= 2 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    
                    let page_films = self.extract_films(&document);
                    
                    // If no films found on this page, we've reached the end
                    if page_films.is_empty() {
                        consecutive_empty_pages += 1;
                        // Don't try next page - we've reached the end
                        break;
                    }
                    
                    consecutive_empty_pages = 0;
                    films.extend(page_films);
                    print_progress(films.len(), "Scraping films");
                    
                    consecutive_errors = 0;

                    // Find next page - try all methods
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        // No next page link found, try to construct next page URL manually
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                        page += 1;
                    }
                }
                Err(e) => {
                    eprintln!("\nError on page {}: {}", page, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= 2 {
                        eprintln!("Too many consecutive errors, stopping");
                        break;
                    }
                    page += 1;
                    if current_url.contains("?page=") {
                        let base: Vec<&str> = current_url.split("?page=").collect();
                        current_url = format!("{}?page={}", base[0], page);
                    } else {
                        current_url = format!("{}?page={}", current_url, page);
                    }
                }
            }
        }
        clear_progress();
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

    async fn scrape_reviews(&self, url: &str) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        
        // Construct reviews URL: replace /films/ with /critiques/films/
        let reviews_url = if url.ends_with("/films/") {
            url.replace("/films/", "/critiques/films/")
        } else if url.ends_with("/films") {
            url.replace("/films", "/critiques/films/")
        } else if url.ends_with('/') {
            format!("{}critiques/films/", url)
        } else {
            format!("{}//critiques/films/", url)
        };
        
        let mut current_url = reviews_url;
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut consecutive_errors = 0;
        let mut consecutive_empty_pages = 0;

        print_progress(reviews.len(), "Scraping reviews");

        loop {
            if visited.contains(&current_url) || page > 100 || consecutive_empty_pages >= 2 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    
                    // Check if there are any review blocks
                    let review_blocks = document.select(&self.selectors.review_block).count();
                    if review_blocks == 0 {
                        consecutive_empty_pages += 1;
                        // Don't try next page - we've reached the end
                        break;
                    }
                    
                    consecutive_empty_pages = 0;
                    let page_reviews = self.extract_reviews(&document, &current_url).await?;
                    
                    if page_reviews.is_empty() {
                        consecutive_empty_pages += 1;
                        // Don't try next page - we've reached the end
                        break;
                    }
                    
                    reviews.extend(page_reviews);
                    print_progress(reviews.len(), "Scraping reviews");
                    
                    consecutive_errors = 0;

                    // Find next page
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        // No next page link found, try to construct next page URL manually
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                        page += 1;
                    }
                }
                Err(e) => {
                    eprintln!("\nError fetching reviews page {}: {}", page, e);
                    consecutive_errors += 1;
                    if consecutive_errors >= 5 {
                        eprintln!("Too many consecutive errors, stopping");
                        break;
                    }
                    page += 1;
                    if current_url.contains("?page=") {
                        let base: Vec<&str> = current_url.split("?page=").collect();
                        current_url = format!("{}?page={}", base[0], page);
                    } else {
                        current_url = format!("{}?page={}", current_url, page);
                    }
                }
            }
        }
        clear_progress();
        Ok(reviews)
    }

    async fn extract_reviews(&self, document: &Html, base_url: &str) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        
        for block in document.select(&self.selectors.review_block) {
            // Extract film title - try to find the movie link in the review card
            // On Allocine, the review card has a link to the movie with class "xXx"
            // The title is inside a span with class containing encoded film id
            
            // First, try to find a link with href containing /film-
            let mut title = String::new();
            for link in block.select(&Selector::parse("a[href*='/film-']").unwrap()) {
                if let Some(href) = link.value().attr("href") {
                    if href.contains("/film-") && !href.contains("critique") {
                        // This is likely the movie link, extract text from it
                        let text = strip_html_tags(&link.inner_html());
                        if !text.is_empty() {
                            title = text;
                            break;
                        }
                    }
                }
            }
            
            // If no movie link found, try the xXx selector
            if title.is_empty() {
                for link in block.select(&self.selectors.review_title) {
                    let text = strip_html_tags(&link.inner_html());
                    // Skip if it's just numbers or empty
                    if !text.is_empty() && !text.chars().all(|c| c.is_numeric() || c.is_whitespace()) {
                        title = text;
                        break;
                    }
                }
            }
            
            // If still empty, try .review-card-title
            if title.is_empty() {
                if let Some(el) = block.select(&Selector::parse(".review-card-title").unwrap()).next() {
                    title = strip_html_tags(&el.inner_html());
                }
            }
            
            // If still empty, try any link that doesn't look like "Lire plus"
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
            
            // Extract review text
            let text = block.select(&self.selectors.review_content)
                .next()
                .map(|c| c.inner_html().trim().to_string())
                .unwrap_or_default();

            // Check for "Lire plus" link
            let has_more = block.select(&self.selectors.review_lire_plus).next().is_some();
            
            let full_text = if has_more {
                if let Some(more_href) = block.select(&self.selectors.review_lire_plus)
                    .next()
                    .and_then(|l| l.value().attr("href"))
                    .and_then(|h| resolve_url(h, base_url)) {
                    match self.fetch_page(&more_href).await {
                        Ok(full_html) => {
                            Html::parse_document(&full_html).select(&self.selectors.review_content)
                                .next()
                                .map(|c| c.inner_html().trim().to_string())
                                .unwrap_or(text)
                        }
                        Err(_) => text,
                    }
                } else {
                    text
                }
            } else {
                text
            };

            // Clean up text like JS version
            let cleaned_text = strip_html_tags(&full_text);

            reviews.push(Review { title, review: cleaned_text });
        }
        
        Ok(reviews)
    }

    async fn scrape_wishlist(&self, url: &str) -> Result<Vec<WishlistItem>> {
        let mut items = Vec::new();
        let base_url = normalize_url(url);
        let wishlist_url = base_url.replace("/films/", "/films/envie-de-voir/");
        let mut current_url = wishlist_url;
        let mut visited = HashSet::new();
        let mut page = 1;
        let mut consecutive_empty_pages = 0;

        print_progress(items.len(), "Scraping wishlist");

        loop {
            if visited.contains(&current_url) || page > 100 || consecutive_empty_pages >= 2 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    
                    let page_items = self.extract_wishlist(&document);
                    if page_items.is_empty() {
                        consecutive_empty_pages += 1;
                        // Don't try next page - we've reached the end
                        break;
                    }
                    
                    consecutive_empty_pages = 0;
                    items.extend(page_items);
                    print_progress(items.len(), "Scraping wishlist");

                    // Find next page
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        // No next page link found, try to construct next page URL manually
                        if current_url.contains("?page=") {
                            let base: Vec<&str> = current_url.split("?page=").collect();
                            current_url = format!("{}?page={}", base[0], page + 1);
                        } else {
                            current_url = format!("{}?page={}", current_url, page + 1);
                        }
                        page += 1;
                    }
                }
                Err(e) => {
                    eprintln!("\nError fetching wishlist page {}: {}", page, e);
                    break;
                }
            }
        }
        clear_progress();
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
            rating: film.rating.clone(),
            review,
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
    rating: String,
    review: String,
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

    let scraper = Scraper::new(args.delay_ms)?;

    // Scrape films
    println!("Scraping films...");
    let films = scraper.scrape_films(&args.url).await?;
    println!("Scraped {} films", films.len());

    // Scrape reviews
    let reviews = if args.skip_reviews {
        println!("Skipping reviews");
        Vec::new()
    } else {
        println!("Scraping reviews...");
        scraper.scrape_reviews(&args.url).await?
    };
    println!("Scraped {} reviews", reviews.len());

    // Scrape wishlist
    let wishlist = if args.skip_wishlist {
        println!("Skipping wishlist");
        Vec::new()
    } else {
        println!("Scraping wishlist...");
        scraper.scrape_wishlist(&args.url).await?
    };
    println!("Scraped {} wishlist items", wishlist.len());

    // Export films
    if !films.is_empty() {
        let entries = if !reviews.is_empty() {
            merge_data(films, reviews)
        } else {
            films.into_iter().map(|f| ExportEntry { title: f.title, rating: f.rating, review: String::new() }).collect()
        };
        
        let path = args.output.join("allocine-films.csv");
        let mut writer = Writer::from_writer(File::create(&path)?);
        writer.serialize(ExportEntry { title: "Title".into(), rating: "Rating".into(), review: "Review".into() })?;
        for entry in &entries {
            writer.serialize(entry)?;
        }
        writer.flush()?;
        println!("Exported {} films to {}", entries.len(), path.display());
    }

    // Export wishlist
    if !wishlist.is_empty() {
        let path = args.output.join("allocine-films-a-voir.csv");
        let mut writer = Writer::from_writer(File::create(&path)?);
        writer.serialize(WishlistItem { title: "Title".into() })?;
        for item in &wishlist {
            writer.serialize(item)?;
        }
        writer.flush()?;
        println!("Exported {} wishlist items to {}", wishlist.len(), path.display());
    }

    println!("");
    println!("Done!");
    Ok(())
}
