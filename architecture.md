# Fiche d’architecture – turbulence-sim

## 1. Objectif général
Le projet “turbulence-sim” est un simulateur numérique de turbulence basé sur les équations de Navier–Stokes.  
L’architecture est conçue pour être simple, claire et structurée, tout en restant ouverte à des ajouts futurs.  
La structure est pensée pour séparer clairement la **représentation du domaine**, la **gestion des champs**, la **physique**, l’**I/O**, et l’**interface Python**.

---

## 2. Structure du projet

```
turbulence-sim/
├── src/
│	├── bc.cpp
│	├── bc.h
│	├── field.cpp
│	├── field.h
│	├── grid.cpp
│	├── grid.h
│	├── io.cpp
│	└── io.h
│	├── main.cpp
│	├── solver.cpp
│	├── solver.h
├── python/
│	├── bindings.cpp
│	├── CMakeLists.txt
│	└── scripts/
│		└── run.py
├── tests/
│	└── test_solver.cpp
├── architecture.md
├── CMakeLists.txt
├── config.yaml
└── README.md
```

---

## 3. Description détaillée des modules

### 3.1 Module `grid`
**Responsabilité :** définir et représenter le domaine de simulation.

- Représente la géométrie du domaine (dimensions, taille, pas de grille).
- Gère l’indexation (conversion indices 3D → index 1D).
- Fournit les propriétés de la grille : taille, nombre de points, pas, périodicité.
- Centralise toutes les informations sur la structure spatiale du problème.

### 3.2 Module `field`
**Responsabilité :** stocker et manipuler les champs physiques.

- Contient les données numériques des champs (vitesse, pression, etc.).
- Définit un champ scalaire et un champ vectoriel.
- Offre des méthodes de base pour :
  - initialisation,
  - accès et modification des valeurs,
  - copie et reset,
  - opérations élémentaires (addition, multiplication, etc.).
- Assure la cohérence de la mémoire et des dimensions.

### 3.3 Module `bc`
**Responsabilité :** appliquer les conditions aux limites.

- Gère les conditions aux limites sur les champs.
- Centralise la logique des différentes BC : Dirichlet, Neumann, Periodic, No-slip, etc.
- Sépare la logique des BC de la logique du solveur.
- Permet de modifier ou ajouter des BC sans toucher au solver.

### 3.4 Module `solver`
**Responsabilité :** faire évoluer la simulation dans le temps.

- Implémente l’intégration temporelle des équations de Navier–Stokes.
- Gère les champs nécessaires (vitesse, pression, etc.).
- Applique les étapes de calcul :
  - calcul des dérivées,
  - mise à jour de la vitesse,
  - résolution de la contrainte d’incompressibilité (projection),
  - application des BC,
  - gestion du pas de temps et de la boucle principale.
- Encapsule la logique numérique et la physique dans une interface unique.

### 3.5 Module `io`
**Responsabilité :** sauvegarde et exportation des résultats.

- Gère l’écriture des champs et des données de simulation sur disque.
- Propose un format simple (CSV/VTK minimal) pour visualisation et analyse.
- Assure la séparation entre le calcul et la persistance des résultats.
- Permet de sauvegarder régulièrement l’état de la simulation.

### 3.6 Module `main`
**Responsabilité :** orchestrer l’exécution globale.

- Charge la configuration (config.yaml).
- Initialise le domaine (`grid`), les champs (`field`) et le solveur (`solver`).
- Lance la boucle de simulation.
- Déclenche les sauvegardes via le module `io`.

### 3.7 Module Python
**Responsabilité :** interface Python via pybind11.

- Expose les fonctionnalités essentielles du simulateur à Python.
- Permet de lancer une simulation depuis un script Python.
- Facilite le contrôle, la configuration et l’analyse des résultats.
- Fournit une API simple et intuitive pour interagir avec le simulateur.

---

## 4. Modules à importer (dépendances)
- C++ standard (C++20)
- pybind11 (pour l’interface Python)
- (optionnel) bibliothèques C++ standards pour la gestion de fichiers et des conteneurs

### Python
- PyYAML (lecture config)
- NumPy (analyse)
- Matplotlib (visualisation)

---

## 5. Fonctionnement global (flux de données)

1. **Lecture de la configuration**
   - `main` lit `config.yaml`
   - crée la grille (`grid`) et les paramètres

2. **Initialisation**
   - `solver` crée les champs (`field`)
   - initialise les conditions initiales
   - applique les conditions aux limites via `bc`

3. **Boucle de simulation**
   - `solver` exécute `step()` en boucle
   - à chaque étape :
     - calcul des dérivées
     - mise à jour des champs
     - application des BC
     - éventuellement sauvegarde via `io`

4. **Sortie**
   - `io` écrit les résultats
   - fin de simulation

5. **Python**
   - `bindings` expose le simulateur
   - `run.py` orchestre la simulation depuis Python