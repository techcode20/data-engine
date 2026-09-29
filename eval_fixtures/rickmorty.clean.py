def clean(df):
    df = df.copy()
    df["episode_count"] = df["episode"].apply(lambda v: len(v) if isinstance(v, list) else 0)
    required = ["id", "name", "status", "species", "gender", "origin.name",
                "location.name", "image", "episode_count", "url", "created"]
    df = df.dropna(subset=["id", "name", "image", "url", "created"])
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]
    df["id"] = pd.to_numeric(df["id"], errors="coerce")
    df = df.dropna(subset=["id"])
    df = df[df["id"] >= 1]
    df = df[df["status"].isin(["Alive", "Dead", "unknown"])]
    df["episode_count"] = pd.to_numeric(df["episode_count"], errors="coerce").fillna(0)
    df["created"] = pd.to_datetime(df["created"], format="mixed", errors="coerce", utc=True).dt.tz_localize(None)
    df = df.dropna(subset=["created"])
    df = df.drop_duplicates(subset=["id", "url"])
    df = df.astype({
        "id": "int64",
        "name": "str",
        "status": "str",
        "species": "str",
        "gender": "str",
        "origin.name": "str",
        "location.name": "str",
        "image": "str",
        "episode_count": "int64",
        "url": "str",
        "created": "datetime64[ns]",
    })
    return df[required].reset_index(drop=True)
