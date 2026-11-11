from pydantic import BaseModel, ConfigDict, Field, field_validator


class SettingsInput(BaseModel):
    model_config = ConfigDict(strict=True)
    workspaceName: str = Field(min_length=1, max_length=50)
    alertsEnabled: bool

    @field_validator("workspaceName", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value
