try:
    import pandera.pandas as pa
except ImportError:
    import pandera as pa

def validate(df, schema: pa.DataFrameSchema):
    try:
        schema.validate(df, lazy=True)
        return True, None
    except pa.errors.SchemaErrors as err:
        return False, err.failure_cases