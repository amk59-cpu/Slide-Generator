from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

SlideType = Literal[
    "grouped_bar",
    "line",
    "difference",
    "data_matrix",
]
Aggregation = Literal["auto", "none", "mean", "median", "max", "min", "sum"]


class SlideRequest(BaseModel):
    table_id: str
    slide_type: SlideType = "grouped_bar"
    title: str = Field(min_length=1, max_length=180)
    category_index: int = 0
    series_indexes: list[int] = Field(default_factory=list, max_length=12)
    group_by_indexes: list[int] = Field(default_factory=list, max_length=3)
    filters: dict[str, list[str]] = Field(default_factory=dict)
    aggregation: Aggregation = "auto"
    sort_categories: bool = True
    x_axis_title: str = ""
    y_axis_title: str = "Value"
    show_data_table: bool = False
    label_simplify: bool = False
    label_replacements: str = Field(default="", max_length=4000)
    label_max_length: int = Field(default=40, ge=12, le=90)

    @field_validator("series_indexes", "group_by_indexes")
    @classmethod
    def unique_indexes(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))

    @field_validator("filters")
    @classmethod
    def clean_filters(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        cleaned: dict[str, list[str]] = {}
        for key, entries in value.items():
            unique = [entry for entry in dict.fromkeys(str(entry) for entry in entries) if entry != ""]
            if unique:
                cleaned[str(key)] = unique[:50]
        return cleaned


class DeckRequest(BaseModel):
    deck_title: str = Field(default="Presentation", min_length=1, max_length=180)
    output_filename: str = Field(default="presentation.pptx", min_length=1, max_length=180)
    slides: list[SlideRequest] = Field(min_length=1, max_length=300)
