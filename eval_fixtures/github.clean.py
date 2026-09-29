def clean(df):
    df = df.copy()
    required = ["login", "id", "node_id", "site_admin", "type"]
    df = df.dropna(subset=["login", "id", "site_admin"])
    df["login"] = df["login"].astype(str).str.strip()
    df = df[df["login"] != ""]
    df["id"] = pd.to_numeric(df["id"], errors="coerce")
    df = df.dropna(subset=["id"])
    df = df[df["id"] >= 1]
    df["site_admin"] = df["site_admin"].map({
        "True": True, "False": False, "true": True, "false": False,
        True: True, False: False, 1: True, 0: False,
    })
    df = df.dropna(subset=["site_admin"])
    df["type"] = df["type"].astype(str).str.strip()
    df = df[df["type"].isin(["User", "Bot"])]
    df = df.drop_duplicates(subset=["id"])
    df = df.astype({
        "login": "str",
        "id": "int64",
        "node_id": "str",
        "site_admin": "bool",
        "type": "str",
    })
    return df[required].reset_index(drop=True)
