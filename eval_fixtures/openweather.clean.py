def clean(df):
    df = df.copy()
    df = df.rename(columns={"main.temp": "temp", "main.humidity": "humidity",
                            "wind.speed": "wind_speed", "dt": "observed_epoch"})
    df = df.dropna(subset=["city", "temp", "humidity", "wind_speed", "observed_epoch"])
    df["city"] = df["city"].astype(str).str.strip()
    df = df[df["city"] != ""]
    for col in ["temp", "humidity", "wind_speed"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["temp", "humidity", "wind_speed"])
    df = df[(df["humidity"] >= 0) & (df["wind_speed"] >= 0)]
    df["observed"] = pd.to_datetime(df["observed_epoch"], unit="s", errors="coerce")
    df = df.dropna(subset=["observed"])
    df = df.astype({
        "city": "str",
        "temp": "float64",
        "humidity": "float64",
        "wind_speed": "float64",
        "observed": "datetime64[ns]",
    })
    return df[["city", "temp", "humidity", "wind_speed", "observed"]].reset_index(drop=True)
