// Allocine2Letterboxd - Rust Version
// High-performance scraper for Allocine profiles

use anyhow::{Context, Result};
use clap::Parser;
use csv::Writer;
use indicatif::ProgressBar;
use log::info;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::PathBuf;
use std::time::Duration;
use url::Url;

#[derive(Parser, Debug)]
#[command(name = "allocine2letterboxd")]
#[command(version = "0.1.0")]
#[command(about = "Export Allocine films to CSV for Letterboxd")]
struct Args {
    /// Allocine profile URL
    #[arg(value_parser = validate_allocine_url)]
    url: String,

    /// Output directory
    #[arg(short, long, default_value = ".")]
    output: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Skip reviews scraping
    #[arg(long)]
    skip_reviews: bool,

    /// Skip wishlist scraping
    #[arg(long)]
    skip_wishlist: bool,
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

struct Selectors {
    film_item: Selector,
    film_title: Selector,
    film_rating: Selector,
    review_block: Selector,
    review_content: Selector,
    review_lire_plus: Selector,
    review_title: Selector,
    next_page: Selector,
    next_page_alt: Selector,
    next_page_href: Selector,
}

impl Selectors {
    fn new() -> Self {
        Self {
            film_item: Selector::parse(".card.entity-card-simple.userprofile-entity-card-simple").unwrap(),
            film_title: Selector::parse(".meta-title.meta-title-link").unwrap(),
            film_rating: Selector::parse(".rating-mdl").unwrap(),
            review_block: Selector::parse(".review-card").unwrap(),
            review_content: Selector::parse(".content-txt.review-card-content").unwrap(),
            review_lire_plus: Selector::parse(".blue-link.link-more").unwrap(),
            review_title: Selector::parse(".review-card-title a.xXx").unwrap(),
            next_page: Selector::parse(".button.button-md.button-primary-full.button-right").unwrap(),
            next_page_alt: Selector::parse("button[title=\"Page suivante\"]").unwrap(),
            next_page_href: Selector::parse("a[href*='?page=']").unwrap(),
        }
    }
}

struct Scraper {
    client: Client,
    selectors: Selectors,
}

impl Scraper {
    fn new() -> Result<Self> {
        let client = Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()?;
        Ok(Self { client, selectors: Selectors::new() })
    }

    async fn fetch_page(&self, url: &str) -> Result<String> {
        let response = self.client.get(url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
            .header("Accept-Language", "fr-FR,fr;q=0.9")
            .send()
            .await
            .context(format!("Failed to fetch: {}", url))?;
        
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP {}: {}", response.status(), url));
        }
        response.text().await.map_err(Into::into)
    }

    async fn scrape_films(&self, url: &str, pb: &ProgressBar) -> Result<Vec<Film>> {
        let mut films = Vec::new();
        let mut current_url = normalize_url(url);
        let mut visited = HashSet::new();
        let mut page = 1;

        loop {
            if visited.contains(&current_url) || page > 100 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    let page_films = self.extract_films(&document);
                    films.extend(page_films);
                    pb.set_message(format!("{} films", films.len()));
                    pb.inc(1);

                    // Try all three next page selectors
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Error on page {}: {}", page, e);
                    break;
                }
            }
        }
        Ok(films)
    }

    fn extract_films(&self, document: &Html) -> Vec<Film> {
        let mut films = Vec::new();
        for el in document.select(&self.selectors.film_item) {
            let title = el.select(&self.selectors.film_title)
                .next()
                .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                .or_else(|| {
                    el.select(&self.selectors.film_title)
                        .next()
                        .map(|t| t.inner_html().trim().to_string())
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
        films
    }

    fn find_next_page(&self, document: &Html, current_url: &str) -> Option<String> {
        // Try primary next page button
        for link in document.select(&self.selectors.next_page) {
            if let Some(href) = link.value().attr("href") {
                return resolve_url(href, current_url);
            }
        }
        
        // Try alternative next page button
        for link in document.select(&self.selectors.next_page_alt) {
            if let Some(href) = link.value().attr("href") {
                return resolve_url(href, current_url);
            }
        }
        
        // Try pagination links with ?page= parameter
        for link in document.select(&self.selectors.next_page_href) {
            if let Some(href) = link.value().attr("href") {
                return resolve_url(href, current_url);
            }
        }
        
        None
    }

    async fn scrape_reviews(&self, url: &str, pb: &ProgressBar) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        let base_url = url.to_string();
        let reviews_url = if base_url.ends_with("/films/") || base_url.ends_with("/films") {
            base_url.replace("/films/", "/critiques/films/").replace("/films", "/critiques/films/")
        } else if base_url.ends_with('/') {
            format!("{}critiques/films/", base_url)
        } else {
            format!("{}//critiques/films/", base_url)
        };
        
        let mut current_url = reviews_url;
        let mut visited = HashSet::new();
        let mut page = 1;

        loop {
            if visited.contains(&current_url) || page > 100 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    let page_reviews = self.extract_reviews(&document, &current_url).await?;
                    reviews.extend(page_reviews);
                    pb.set_message(format!("{} reviews", reviews.len()));
                    pb.inc(1);

                    // Try all three next page selectors for reviews
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Error fetching reviews page {}: {}", page, e);
                    break;
                }
            }
        }
        Ok(reviews)
    }

    async fn extract_reviews(&self, document: &Html, base_url: &str) -> Result<Vec<Review>> {
        let mut reviews = Vec::new();
        for block in document.select(&self.selectors.review_block) {
            let title = block.select(&self.selectors.review_title)
                .next()
                .map(|t| t.inner_html().trim().to_string())
                .unwrap_or_default();
            
            let text = block.select(&self.selectors.review_content)
                .next()
                .map(|c| c.inner_html().trim().to_string())
                .unwrap_or_default();

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

            reviews.push(Review { title, review: full_text });
        }
        Ok(reviews)
    }

    async fn scrape_wishlist(&self, url: &str, pb: &ProgressBar) -> Result<Vec<WishlistItem>> {
        let mut items = Vec::new();
        let base_url = normalize_url(url);
        let wishlist_url = base_url.replace("/films/", "/films/envie-de-voir/");
        let mut current_url = wishlist_url;
        let mut visited = HashSet::new();
        let mut page = 1;

        loop {
            if visited.contains(&current_url) || page > 100 {
                break;
            }
            visited.insert(current_url.clone());

            match self.fetch_page(&current_url).await {
                Ok(html) => {
                    let document = Html::parse_document(&html);
                    items.extend(self.extract_wishlist(&document));
                    pb.set_message(format!("{} items", items.len()));
                    pb.inc(1);

                    // Try all three next page selectors for wishlist
                    let next_url = self.find_next_page(&document, &current_url);
                    if let Some(next) = next_url {
                        current_url = next;
                        page += 1;
                    } else {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Error fetching wishlist page {}: {}", page, e);
                    break;
                }
            }
        }
        Ok(items)
    }

    fn extract_wishlist(&self, document: &Html) -> Vec<WishlistItem> {
        document.select(&self.selectors.film_item)
            .filter_map(|el| {
                el.select(&self.selectors.film_title)
                    .next()
                    .and_then(|t| t.value().attr("title").map(|s| s.to_string()))
                    .or_else(|| {
                        el.select(&self.selectors.film_title)
                            .next()
                            .map(|t| t.inner_html().trim().to_string())
                    })
                    .map(|title| WishlistItem { title })
            })
            .collect()
    }
}

fn resolve_url(href: &str, base_url: &str) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        Some(href.to_string())
    } else {
        Url::parse(base_url).ok().and_then(|base| base.join(href).ok()).map(|u| u.to_string())
    }
}

fn normalize_title(title: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    title.nfkd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect::<String>().to_lowercase()
}

fn merge_data(films: Vec<Film>, reviews: Vec<Review>) -> Vec<ExportEntry> {
    let review_map: HashMap<String, String> = reviews
        .into_iter()
        .map(|r| (normalize_title(&r.title), r.review))
        .collect();
    
    films.into_iter()
        .map(|f| {
            let norm_title = normalize_title(&f.title);
            ExportEntry {
                title: f.title,
                rating: f.rating,
                review: review_map.get(&norm_title).cloned().unwrap_or_default(),
            }
        })
        .collect()
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
    env_logger::Builder::from_default_env().format_timestamp(None).init();
    let args = Args::parse();

    if args.verbose {
        std::env::set_var("RUST_LOG", "info");
        env_logger::Builder::from_default_env().format_timestamp(None).init();
    }

    info!("Allocine2Letterboxd - Rust Version");
    info!("Starting scrape for: {}", args.url);

    if !args.output.exists() {
        std::fs::create_dir_all(&args.output)?;
    }

    let scraper = Scraper::new()?;

    // Scrape films
    info!("Scraping films...");
    let pb_films = ProgressBar::new_spinner();
    pb_films.set_style(indicatif::ProgressStyle::default_spinner().template("{spinner} {msg}").unwrap());
    let films = scraper.scrape_films(&args.url, &pb_films).await?;
    pb_films.finish_with_message(format!("Scraped {} films", films.len()));

    // Scrape reviews
    let reviews = if args.skip_reviews {
        info!("Skipping reviews");
        Vec::new()
    } else {
        info!("Scraping reviews...");
        let pb_reviews = ProgressBar::new_spinner();
        pb_reviews.set_style(indicatif::ProgressStyle::default_spinner().template("{spinner} {msg}").unwrap());
        scraper.scrape_reviews(&args.url, &pb_reviews).await?
    };

    // Scrape wishlist
    let wishlist = if args.skip_wishlist {
        info!("Skipping wishlist");
        Vec::new()
    } else {
        info!("Scraping wishlist...");
        let pb_wishlist = ProgressBar::new_spinner();
        pb_wishlist.set_style(indicatif::ProgressStyle::default_spinner().template("{spinner} {msg}").unwrap());
        scraper.scrape_wishlist(&args.url, &pb_wishlist).await?
    };

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
        info!("Exported {} films to {}", entries.len(), path.display());
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
        info!("Exported {} wishlist items to {}", wishlist.len(), path.display());
    }

    info!("Done!");
    Ok(())
}
