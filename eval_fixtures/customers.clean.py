def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "email", "plan", "revenue"]
    df = df.dropna(subset=required)
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]
    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df["signup_date"] = pd.to_datetime(df["signup_date"], format="mixed", errors="coerce")
    df = df.dropna(subset=["signup_date"])
    df["email"] = df["email"].astype(str).str.lower().str.strip()
    df = df[df["email"].str.match(r"^[^@]+@[^@]+\.[^@]+$", na=False)]
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]
    df["revenue"] = df["revenue"].astype(str).str.replace("$", "", regex=False).str.strip()
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])
    df = df[df["revenue"] >= 0]
    df = df.drop_duplicates(subset=["customer_id"])
    df = df.astype({
        "customer_id": "int64",
        "name": "str",
        "signup_date": "datetime64[ns]",
        "email": "str",
        "plan": "str",
        "revenue": "float64",
    })
    return df[required].reset_index(drop=True)
