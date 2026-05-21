#!/usr/bin/env python3
"""
Timecop SQLite Database Migration Tool
Converts the SQLite database from the Flask version of TimeCop into a standard
JSON state import payload compatible with the new high-fidelity static web app.
Uses built-in modules only—no installation required!
"""

import os
import sqlite3
import json
from datetime import datetime, timezone

# Curated gradients mapping based on category/color names
GRADIENT_MAP = {
  'development': 'gradient-cyan-blue',
  'coding': 'gradient-cyan-blue',
  'design': 'gradient-pink-rose',
  'meeting': 'gradient-amber-orange',
  'sync': 'gradient-amber-orange',
  'operations': 'gradient-forest-mint',
  'sys': 'gradient-forest-mint',
  'personal': 'gradient-violet-flare',
  'break': 'gradient-violet-flare',
  'idle': 'gradient-idle'
}

def get_gradient_for_project(name, category, color):
  """Maps old project data to one of the new high-fidelity visual gradients."""
  key = (category or name or '').lower()
  for keyword, gradient in GRADIENT_MAP.items():
    if keyword in key:
      return gradient
  
  # Color name heuristic mapping
  color_lower = (color or '').lower()
  if 'blue' in color_lower or 'cyan' in color_lower or 'teal' in color_lower:
    return 'gradient-cyan-blue'
  elif 'red' in color_lower or 'pink' in color_lower or 'rose' in color_lower:
    return 'gradient-pink-rose'
  elif 'yellow' in color_lower or 'orange' in color_lower or 'amber' in color_lower:
    return 'gradient-amber-orange'
  elif 'green' in color_lower or 'mint' in color_lower:
    return 'gradient-forest-mint'
  elif 'purple' in color_lower or 'violet' in color_lower:
    return 'gradient-violet-flare'
    
  # Deterministic round-robin default
  gradients = ['gradient-cyan-blue', 'gradient-pink-rose', 'gradient-amber-orange', 'gradient-forest-mint', 'gradient-violet-flare']
  h = hash(name or '') % len(gradients)
  return gradients[h]

def parse_sqlite_timestamp(val):
  """Parses typical SQLite DateTime string formats into millisecond epochs."""
  if val is None:
    return None
  
  # If already an integer timestamp
  if isinstance(val, (int, float)):
    if val < 5000000000:  # Seconds format
      return int(val * 1000)
    return int(val)       # Milliseconds format
    
  val_str = str(val).strip()
  if val_str.isdigit():
    num = int(val_str)
    if num < 5000000000:
      return num * 1000
    return num
    
  # Parse standard SQLite ISO datetimes: "YYYY-MM-DD HH:MM:SS.mmmmmm" or "YYYY-MM-DDTHH:MM:SS"
  for fmt in (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d"
  ):
    try:
      dt = datetime.strptime(val_str, fmt)
      dt = dt.replace(tzinfo=timezone.utc)
      return int(dt.timestamp() * 1000)
    except ValueError:
      continue
      
  # Fallback: try raw dateutil-like parse if possible, else return None
  print(f"Warning: Could not parse timestamp string '{val_str}'. Timeline might contain a gap.")
  return None

def migrate():
  print("=" * 60)
  print("        TIMECOP SQLite MIGRATION UTILITY")
  print("=" * 60)
  
  # Attempt to locate the database
  default_db_path = r"C:\Users\jomiller\OneDrive - H-E Parts International\.Projects\TimeCop\instance\time_tracker.db"
  
  db_path = input(f"Enter the path to your Flask SQLite db\n[Default: {default_db_path}]: ").strip()
  if not db_path:
    db_path = default_db_path
    
  if not os.path.exists(db_path):
    print(f"\nError: Could not find database file at: {db_path}")
    print("Please double check the path and run this script again.")
    return
    
  print(f"\nConnecting to: {db_path}...")
  
  try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Fetch Projects
    print("Reading project definitions...")
    cursor.execute("SELECT * FROM project")
    old_projects = cursor.fetchall()
    
    # 2. Fetch Punches
    print("Reading punch timeline logs...")
    cursor.execute("SELECT * FROM punch")
    old_punches = cursor.fetchall()
    
    print(f"Loaded {len(old_projects)} projects and {len(old_punches)} punches from SQLite.")
    
  except sqlite3.Error as e:
    print(f"\nSQLite Error: {e}")
    print("Ensure the database structure has table names 'project' and 'punch'.")
    return
    
  # Map projects
  migrated_projects = []
  project_id_map = {}
  
  # Standard default Idle
  idle_project = {
    'id': 'idle',
    'name': 'Idle',
    'category': 'System',
    'gradient': 'gradient-idle',
    'order': 0
  }
  migrated_projects.append(idle_project)
  project_id_map['idle'] = 'idle'
  
  # Transfer other projects
  order_counter = 1
  for op in old_projects:
    op = dict(op) # Convert sqlite3.Row to standard dict
    
    # Robust key fetching for project ID
    old_id_val = op.get('id') or op.get('Id') or op.get('ID')
    if old_id_val is None:
      for k, v in op.items():
        if k.lower() == 'id':
          old_id_val = v
          break
    old_id = str(old_id_val) if old_id_val is not None else str(order_counter)
    
    # Robust name fetching
    name_val = op.get('name') or op.get('Name') or op.get('title') or op.get('Title')
    if name_val is None:
      for k, v in op.items():
        if k.lower() in ('name', 'title'):
          name_val = v
          break
    name_val = name_val or "Unnamed Project"
    
    # If the old project is already an 'Idle' placeholder, map it directly
    if name_val.lower() == 'idle':
      project_id_map[old_id] = 'idle'
      continue
      
    proj_id = f"proj-{old_id}"
    project_id_map[old_id] = proj_id
    
    category_val = op.get('category') or op.get('Category')
    if category_val is None:
      for k, v in op.items():
        if k.lower() == 'category':
          category_val = v
          break
          
    color_val = op.get('color') or op.get('Color')
    if color_val is None:
      for k, v in op.items():
        if k.lower() == 'color':
          color_val = v
          break
          
    gradient = get_gradient_for_project(name_val, category_val, color_val)
    
    order_val = op.get('order') or op.get('Order')
    if order_val is None:
      for k, v in op.items():
        if k.lower() == 'order':
          order_val = v
          break
    order_val = order_val or order_counter
    
    migrated_projects.append({
      'id': proj_id,
      'name': name_val,
      'category': category_val or 'General',
      'gradient': gradient,
      'order': order_val
    })
    order_counter += 1
    
  # Map punches
  migrated_punches = []
  active_punch_id = None
  
  for idx, op in enumerate(old_punches):
    op = dict(op) # Convert sqlite3.Row to standard dict
    
    # Robust project ID reference safety
    old_proj_id = op.get('project_id') or op.get('projectId') or op.get('project') or op.get('projectID') or op.get('project_Id')
    if old_proj_id is None:
      for k, v in op.items():
        if k.lower() in ('project_id', 'projectid', 'project'):
          old_proj_id = v
          break
    old_proj_id = str(old_proj_id) if old_proj_id is not None else ''
    proj_id = project_id_map.get(old_proj_id, 'idle')
    
    # Robust start time parsing
    start_ms = parse_sqlite_timestamp(op.get('start_time') or op.get('startTime') or op.get('start') or op.get('start_time_ms'))
    if start_ms is None:
      for k, v in op.items():
        if k.lower() in ('start_time', 'starttime', 'start'):
          start_ms = parse_sqlite_timestamp(v)
          break
          
    # Robust end time parsing
    end_ms = parse_sqlite_timestamp(op.get('end_time') or op.get('endTime') or op.get('end') or op.get('end_time_ms'))
    if end_ms is None:
      has_end_key = False
      for k in op.keys():
        if k.lower() in ('end_time', 'endtime', 'end'):
          has_end_key = True
          break
      if not has_end_key:
        for k, v in op.items():
          if k.lower() in ('end_time', 'endtime', 'end'):
            end_ms = parse_sqlite_timestamp(v)
            break
            
    # Skip invalid punches
    if start_ms is None:
      continue
      
    punch_id_val = op.get('id') or op.get('Id') or op.get('ID') or idx
    punch_id = f"punch-{punch_id_val}"
    
    # Identify if running punch
    is_active = (end_ms is None)
    if is_active:
      active_punch_id = punch_id
      
    migrated_punches.append({
      'id': punch_id,
      'projectId': proj_id,
      'startTime': start_ms,
      'endTime': end_ms
    })
    
  # Compile Output Schema
  output_db = {
    'projects': migrated_projects,
    'punches': migrated_punches,
    'activePunchId': active_punch_id
  }
  
  # Write file
  output_filename = "timecop_import_payload.json"
  with open(output_filename, 'w') as f:
    json.dump(output_db, f, indent=2)
    
  print("\n" + "=" * 60)
  print("        MIGRATION COMPILED SUCCESSFULLY!")
  print("=" * 60)
  print(f"Output File: [ {os.path.abspath(output_filename)} ]")
  print(f"Contains   : {len(migrated_projects)} projects, {len(migrated_punches)} punches.")
  print("\nNext Steps:")
  print("1. Open the new Timecop Web App in your browser.")
  print("2. Click the 'Backup & Sync' button in the top right header.")
  print("3. Click 'Select & Upload JSON' under the 'Import Database' section.")
  print("4. Select the generated 'timecop_import_payload.json' file.")
  print("All your project names, category parameters, and historical timelines will restore instantly!")
  print("=" * 60)

if __name__ == "__main__":
  migrate()
