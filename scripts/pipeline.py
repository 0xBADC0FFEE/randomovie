"""
Data pipeline: HuggingFace movie embeddings → embeddings.bin for Randomovie.

Steps:
1. Load movie dataset with precomputed embeddings from HuggingFace
2. Filter: has poster, >100 votes, rating >5.0
3. UMAP: reduce 768-dim → 16-dim
4. Quantize: float32 → uint8 (min-max per axis)
5. Output: embeddings.bin

Usage:
    pip install datasets numpy umap-learn
    python scripts/pipeline.py
"""

import struct
import json
import ast
from pathlib import Path

import numpy as np


def load_dataset():
    """Load movie dataset from HuggingFace."""
    from datasets import load_dataset
    print("Loading dataset from HuggingFace...")
    ds = load_dataset("Remsky/Embeddings__Ultimate_1Million_Movies_Dataset", split="train")
    print(f"Loaded {len(ds)} movies")
    return ds


def filter_movies(ds):
    """Keep movies with poster, enough votes, decent rating."""
    print("Filtering movies...")
    filtered = []
    for row in ds:
        poster = row.get("poster_path")
        votes = row.get("vote_count", 0) or 0
        rating = row.get("vote_average", 0) or 0
        embedding_str = row.get("embedding")

        if not poster or votes < 100 or rating < 5.0 or not embedding_str:
            continue

        # Parse embedding from string representation
        try:
            embedding = ast.literal_eval(embedding_str)
            if not isinstance(embedding, list) or len(embedding) < 16:
                continue
        except (ValueError, SyntaxError):
            continue

        title = row.get("title") or row.get("original_title") or ""
        if not title:
            continue

        filtered.append({
            "tmdb_id": row["id"],
            "title": title,
            "poster_path": poster,
            "embedding": np.array(embedding, dtype=np.float32),
        })

    print(f"Kept {len(filtered)} movies after filtering")
    return filtered


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
    ranges[ranges == 0] = 1  # avoid division by zero
    normalized = (embeddings - mins) / ranges  # [0, 1]
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
            title = movie["title"].encode("utf-8")[:255]  # clamp to uint8 max

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
    output_dir = Path(__file__).parent.parent / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "embeddings.bin"

    ds = load_dataset()
    movies = filter_movies(ds)

    if not movies:
        print("ERROR: No movies passed filters!")
        return

    reduced = reduce_dimensions(movies, target_dim=16)
    quantized = quantize(reduced)
    write_binary(movies, quantized, output_path)

    titles_path = output_dir / "titles.bin"
    write_titles_binary(movies, titles_path)

    print(f"\nDone! File: {output_path}")
    print(f"Movies: {len(movies)}")
    print(f"To test: cd .. && npx vite")


if __name__ == "__main__":
    main()
