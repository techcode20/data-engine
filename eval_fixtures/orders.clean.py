def clean(df):
    df = df.copy()
    required = ["user_id", "full_name", "joined", "contact", "tier", "mrr"]
    df = df.dropna(subset=required)
    df["full_name"] = df["full_name"].astype(str).str.strip()
    df = df[df["full_name"] != ""]
    df["user_id"] = pd.to_numeric(df["user_id"], errors="coerce")
    df = df.dropna(subset=["user_id"])
    df["joined"] = pd.to_datetime(df["joined"], format="mixed", errors="coerce")
    df = df.dropna(subset=["joined"])
    df["contact"] = df["contact"].astype(str).str.lower().str.strip()
    df = df[df["contact"].str.match(r"^[^@]+@[^@]+\.[^@]+$", na=False)]
    df["tier"] = df["tier"].astype(str).str.upper().str.strip()
    df = df[df["tier"].isin(["STARTER", "ENTERPRISE"])]
    df["mrr"] = df["mrr"].astype(str).str.replace("$", "", regex=False).str.strip()
    df["mrr"] = pd.to_numeric(df["mrr"], errors="coerce")
    df = df.dropna(subset=["mrr"])
    df = df[df["mrr"] >= 0]
    df = df.drop_duplicates(subset=["user_id"])
    df = df.astype({
        "user_id": "int64",
        "full_name": "str",
        "joined": "datetime64[ns]",
        "contact": "str",
        "tier": "str",
        "mrr": "float64",
    })
    return df[required].reset_index(drop=True)
