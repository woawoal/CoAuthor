import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, Text, ForeignKey, Boolean, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CharacterRole(str, Enum):
    PROTAGONIST = "protagonist"
    SUPPORTING = "supporting"
    VILLAIN = "villain"
    NARRATOR = "narrator"


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    world_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[CharacterRole] = mapped_column(SAEnum(CharacterRole), nullable=False)
    personality: Mapped[str] = mapped_column(Text, default="")
    background: Mapped[str] = mapped_column(Text, default="")
    appearance: Mapped[str] = mapped_column(Text, default="")
    is_ai_controlled: Mapped[bool] = mapped_column(Boolean, default=True)  # 조연은 AI 제어
    system_prompt: Mapped[str] = mapped_column(Text, default="")           # AI용 시스템 프롬프트
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    world: Mapped["World"] = relationship(back_populates="characters")
    dialogues: Mapped[list["Dialogue"]] = relationship(back_populates="character")
