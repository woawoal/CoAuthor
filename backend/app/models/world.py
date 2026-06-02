import uuid
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class World(Base):
    __tablename__ = "worlds"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    genre: Mapped[str] = mapped_column(String(50), default="")
    setting: Mapped[str] = mapped_column(Text, default="")   # 시대/공간 배경
    rules: Mapped[str] = mapped_column(Text, default="")     # 세계관 규칙
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="worlds")
    characters: Mapped[list["Character"]] = relationship(back_populates="world", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(back_populates="world")
