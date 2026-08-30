# Heatwave 99 game design

## Product sentence

A fast first-person crime game where one short job forces the player to walk,
drive, fight, attract police, escape, and cash out.

## Player promise

The game should feel loose and reactive like a crime sandbox, but every action
should move at boomer-shooter speed. There are no reload animations, inventory
screens, traffic laws, or long conversations. The player reads the street,
commits, and keeps moving.

## The first job

Pelican Drop takes about five minutes on a clean run.

| State | Objective | System introduced |
| --- | --- | --- |
| Pager | Find the coral coupe outside Sunwash Motel | Bearing and minimap |
| Getaway | Drive east to Pelican Marina | Vehicle movement |
| Raid | Exit the car and take the package | Shotgun, SMG, enemy pursuit |
| Heat | Break police sight | Patrol spawns, heat timer |
| Delivery | Reach the chop shop south of the canal | Route choice |
| Payout | Review the run | Time, kills, heat, health, cash |

## Systems

### Movement

Walking is fast and supports forward movement, strafing, sprinting, and mouse
look. The arrow keys provide turning when pointer lock is unavailable.

The coupe uses the same collision map with a larger radius and higher speed.
The first build skips suspension, traffic, passengers, and drive-by shooting.

### Combat

Both weapons use hitscan against hostile actors with wall occlusion.

| Weapon | Role | Damage | Cooldown |
| --- | --- | ---: | ---: |
| Sawed-off shotgun | Close-range burst | 78 | 0.56 seconds |
| Compact SMG | Accurate follow-up shots | 29 | 0.095 seconds |

Gang members and patrol officers share a small state model. They pursue when
they have line of sight and fire inside their weapon range. Patrol officers are
tougher and faster.

### Heat and police

Heat has three visible levels. A civilian who sees gunfire panics, runs, and
reports the crime after a short delay. A patrol officer who sees the crime calls
it in at once. Taking the package jumps the response to level two. Shooting a
patrol officer raises it to level three.

Officers remember the player's last-known position and path toward it after
line of sight breaks. The HUD separates reporting, spotted, and searching
states. Higher heat adds officers and parked roadblocks. Once sight stays broken
long enough, heat drains and the response clears. The player must clear heat
before the delivery marker accepts the package.

This is a deliberate compression of the recognition system described in the
August 2026 GTA VI press preview. A larger version could track face, clothes,
vehicle, witnesses, and accomplice state separately.

### Street life

Twelve civilians walk deterministic routes through the district. Gunfire makes
nearby civilians flee. Civilians with a clear view begin a visible report delay.
The player can approach a calm civilian and press `F` for a local tip.

Civilian movement uses the same collision grid as the player. The small cast is
intentional. It keeps every person legible on the minimap and leaves enough
simulation budget for police searches.

### Interiors and shops

Sunwash Lobby, Sunshot Pawn, and Neon Gator Arcade are carved into the existing
building blocks. Their doors, floors, walls, actors, and the street all share
one map. There is no loading screen or separate scene.

Each room has one clerk and one service. Sunwash sells armor for $100, Sunshot
sells ammunition for $75, and Neon Gator sells health for $50. Cars stop at the
door, while people and police can enter.

### Rendering

The world uses a Canvas 2D DDA raycaster. React owns the title, pause, and
result overlays. The simulation runs at a fixed 60 Hz outside React state.

The palette uses coral stucco, turquoise glass, purple asphalt, and dirty yellow
signage. Generated 64-pixel sprites supply the enemies and first-person
weapons. The interface uses a chunky monospace HUD and red heat diamonds.

## Map

The district is a 34 by 34 tile grid with three east-west roads, three
north-south roads, nine building blocks, three furnished rooms, and a narrow
drainage-canal crossing. The important landmarks are Sunwash Motel, Sunshot
Pawn, Neon Gator Arcade, Pelican Marina, and the chop shop.

The map is small on purpose. The job can put a landmark on the horizon while
still letting the player choose a street or canal approach.

## Scope cuts

The current build does not include traffic simulation, boats, destructible
buildings, saves, multiplayer, dialogue trees, licensed music, touch controls,
or character switching.

The next useful addition is traffic and driver panic. Cars should react to
sirens, gunfire, roadblocks, and collisions before the map gets any larger.
