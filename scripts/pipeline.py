"""
Data pipeline: Kaggle TMDB dataset → Ollama embeddings → UMAP → binary output.

Steps:
1. Download dataset from Kaggle (alanvourch/tmdb-movies-daily-updates)
2. Filter: has poster, >100 votes, rating >5.0, has text
3. Generate 768-dim embeddings via Ollama (nomic-embed-text-v2-moe)
4. Cache embeddings in scripts/embedding_cache.npz
5. UMAP: 768-dim → 16-dim
6. Quantize: float32 → uint8 (min-max per axis)
7. Output: embeddings.bin + titles.bin

Usage:
    pip install kagglehub pandas numpy umap-learn requests
    ollama pull nomic-embed-text-v2-moe
    python scripts/pipeline.py
"""

import struct
import sys
from pathlib import Path

import numpy as np
import requests

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text-v2-moe"
EMBED_DIM = 768
BATCH_SIZE = 64
CACHE_PATH = Path(__file__).parent / "embedding_cache.npz"


def check_ollama():
    """Verify Ollama is running and model is available. Fail fast."""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        r.raise_for_status()
    except (requests.ConnectionError, requests.Timeout):
        print("ERROR: Ollama not running. Start it with: ollama serve")
        sys.exit(1)

    models = [m["name"] for m in r.json().get("models", [])]
    # Match with or without :latest tag
    if not any(EMBED_MODEL in m for m in models):
        print(f"ERROR: Model '{EMBED_MODEL}' not found. Pull it with:")
        print(f"  ollama pull {EMBED_MODEL}")
        sys.exit(1)

    print(f"Ollama OK — model '{EMBED_MODEL}' available")


def load_dataset():
    """Download and load dataset from Kaggle."""
    import kagglehub
    import pandas as pd

    print("Downloading dataset from Kaggle...")
    path = kagglehub.dataset_download("alanvourch/tmdb-movies-daily-updates")
    csv_files = list(Path(path).glob("*.csv"))
    if not csv_files:
        print(f"ERROR: No CSV files found in {path}")
        sys.exit(1)

    csv_path = csv_files[0]
    print(f"Reading {csv_path.name}...")
    df = pd.read_csv(csv_path, low_memory=False)
    print(f"Loaded {len(df)} movies")
    return df


def filter_movies(df):
    """Keep movies with poster, enough votes, decent rating, and text for embedding."""
    print("Filtering movies...")
    filtered = []
    for _, row in df.iterrows():
        poster = row.get("poster_path")
        if not isinstance(poster, str) or not poster:
            continue

        votes = row.get("vote_count", 0)
        rating = row.get("vote_average", 0)
        try:
            votes = float(votes or 0)
            rating = float(rating or 0)
        except (ValueError, TypeError):
            continue

        if votes < 100 or rating < 5.0:
            continue

        title = str(row.get("title") or row.get("original_title") or "").strip()
        if not title:
            continue

        # Build text for embedding
        tagline = str(row.get("tagline") or "").strip()
        overview = str(row.get("overview") or "").strip()
        tto = row.get("title_tagline_overview")
        if isinstance(tto, str) and tto.strip():
            text = tto.strip()
        else:
            parts = [p for p in [title, tagline, overview] if p]
            text = ". ".join(parts)

        if not text:
            continue

        tmdb_id = int(row.get("id", 0))
        if tmdb_id <= 0:
            continue

        filtered.append({
            "tmdb_id": tmdb_id,
            "title": title,
            "poster_path": poster,
            "text": text,
        })

    print(f"Kept {len(filtered)} movies after filtering")
    return filtered


def load_embedding_cache():
    """Load cached embeddings from disk. Returns dict of tmdb_id → embedding."""
    if not CACHE_PATH.exists():
        return {}
    print(f"Loading embedding cache from {CACHE_PATH.name}...")
    data = np.load(CACHE_PATH)
    cache = {int(k): data[k] for k in data.files}
    print(f"  {len(cache)} cached embeddings")
    return cache


def save_embedding_cache(cache):
    """Save embedding cache to disk."""
    print(f"Saving embedding cache ({len(cache)} entries)...")
    np.savez_compressed(CACHE_PATH, **{str(k): v for k, v in cache.items()})


def generate_embeddings(movies, cache):
    """Generate embeddings via Ollama for movies not in cache."""
    # Split into cached and uncached
    to_embed = [m for m in movies if m["tmdb_id"] not in cache]
    print(f"Embeddings: {len(movies) - len(to_embed)} cached, {len(to_embed)} to generate")

    if not to_embed:
        return cache

    for i in range(0, len(to_embed), BATCH_SIZE):
        batch = to_embed[i:i + BATCH_SIZE]
        texts = [f"search_document: {m['text']}" for m in batch]

        r = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": texts},
            timeout=300,
        )
        r.raise_for_status()
        embeddings = r.json()["embeddings"]

        for m, emb in zip(batch, embeddings):
            cache[m["tmdb_id"]] = np.array(emb, dtype=np.float32)

        done = min(i + BATCH_SIZE, len(to_embed))
        print(f"  Embedded {done}/{len(to_embed)}")

    save_embedding_cache(cache)
    return cache


def reduce_dimensions(movies, target_dim=16):
    """UMAP reduction from high-dim to target_dim."""
    import umap
    print(f"Running UMAP {movies[0]['embedding'].shape[0]}-dim → {target_dim}-dim...")
    embeddings = np.stack([m["embedding"] for m in movies])

    reducer = umap.UMAP(
        n_components=target_dim,
        metric="cosine",
        n_neighbors=30,
        min_dist=0.1,
        random_state=42,
        verbose=True,
    )
    reduced = reducer.fit_transform(embeddings)
    print(f"UMAP done. Shape: {reduced.shape}")
    return reduced


def quantize(embeddings):
    """Quantize float32 → uint8 per axis (min-max normalization)."""
    print("Quantizing to uint8...")
    mins = embeddings.min(axis=0)
    maxs = embeddings.max(axis=0)
    ranges = maxs - mins
    ranges[ranges == 0] = 1
    normalized = (embeddings - mins) / ranges
    quantized = (normalized * 255).clip(0, 255).astype(np.uint8)
    print(f"Quantized shape: {quantized.shape}")
    return quantized


def write_titles_binary(movies, output_path):
    """
    Write titles.bin:
    [count: uint32]
    [per movie: tmdb_id: uint32, title_len: uint8, title: utf8]
    """
    print(f"Writing {output_path}...")
    with open(output_path, "wb") as f:
        f.write(struct.pack("<I", len(movies)))

        for movie in movies:
            tmdb_id = movie["tmdb_id"]
            title = movie["title"].encode("utf-8")[:255]

            f.write(struct.pack("<I", tmdb_id))
            f.write(struct.pack("<B", len(title)))
            f.write(title)

    size = Path(output_path).stat().st_size
    print(f"Written {len(movies)} titles, {size:,} bytes ({size / 1024 / 1024:.1f} MB)")


def write_binary(movies, quantized, output_path):
    """
    Write embeddings.bin:
    [count: uint32]
    [per movie: tmdb_id: uint32, poster_path_len: uint8, poster_path: utf8, embedding: uint8[16]]
    """
    print(f"Writing {output_path}...")
    with open(output_path, "wb") as f:
        f.write(struct.pack("<I", len(movies)))

        for i, movie in enumerate(movies):
            tmdb_id = movie["tmdb_id"]
            poster_path = movie["poster_path"].encode("utf-8")
            embedding = quantized[i]

            f.write(struct.pack("<I", tmdb_id))
            f.write(struct.pack("<B", len(poster_path)))
            f.write(poster_path)
            f.write(embedding.tobytes())

    size = Path(output_path).stat().st_size
    print(f"Written {len(movies)} movies, {size:,} bytes ({size / 1024 / 1024:.1f} MB)")


def main():
    check_ollama()

    output_dir = Path(__file__).parent.parent / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_dataset()
    movies = filter_movies(df)

    if not movies:
        print("ERROR: No movies passed filters!")
        return

    # Generate embeddings
    cache = load_embedding_cache()
    cache = generate_embeddings(movies, cache)

    # Attach embeddings to movies
    for m in movies:
        m["embedding"] = cache[m["tmdb_id"]]

    # UMAP + quantize + write
    reduced = reduce_dimensions(movies, target_dim=16)
    quantized = quantize(reduced)
    write_binary(movies, quantized, output_dir / "embeddings.bin")
    write_titles_binary(movies, output_dir / "titles.bin")

    print(f"\nDone! Movies: {len(movies)}")
    print("To test: npx vite")


if __name__ == "__main__":
    main()
