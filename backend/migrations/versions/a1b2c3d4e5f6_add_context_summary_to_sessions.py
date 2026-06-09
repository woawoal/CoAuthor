"""add context_summary to sessions

Revision ID: a1b2c3d4e5f6
Revises: 81fac960a2a7
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '81fac960a2a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('context_summary', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'context_summary')
