import React, { useState } from 'react';
import { useAppStore } from '../stores/appStore';
// import { validateProjectName } from '../utils/validation';

// Temporary inline validation to fix import issue
const validateProjectName = (name: string): string | null => {
  if (!name.trim()) {
    return 'Project name is required';
  }
  if (name.length < 2) {
    return 'Project name must be at least 2 characters';
  }
  if (name.length > 50) {
    return 'Project name must be less than 50 characters';
  }
  return null;
};
import type { Project } from '../types/index';

interface ProjectCardProps {
  project: Project;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  isActive: boolean;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onLoad, onDelete, isActive }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    onDelete(project.id);
    setShowDeleteConfirm(false);
  };

  return (
    <div className={`bg-white dark:bg-dark-800 rounded-lg border-2 transition-colors ${
      isActive ? 'border-primary-500' : 'border-gray-200 dark:border-dark-700'
    }`}>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {project.description}
              </p>
            )}
            <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span>BPM: {project.bpm}</span>
              <span>Updated: {new Date(project.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onLoad(project.id)}
              className="btn-primary text-sm"
              disabled={isActive}
            >
              {isActive ? 'Active' : 'Load'}
            </button>
            
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
              aria-label="Delete project"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-800 rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Project</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to delete "{project.name}"? This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md font-medium transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description?: string) => void;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const nameError = validateProjectName(name);
    if (nameError) {
      setError(nameError);
      return;
    }

    onCreate(name.trim(), description.trim() || undefined);
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-800 rounded-lg p-6 max-w-md mx-4 w-full">
        <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="project-name" className="block text-sm font-medium mb-2">
              Project Name *
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-600 rounded-md bg-white dark:bg-dark-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="My Awesome Track"
              autoFocus
            />
          </div>
          
          <div className="mb-4">
            <label htmlFor="project-description" className="block text-sm font-medium mb-2">
              Description
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-600 rounded-md bg-white dark:bg-dark-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Optional description..."
              rows={3}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex space-x-3">
            <button
              type="submit"
              className="flex-1 btn-primary"
            >
              Create Project
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ProjectManager: React.FC = () => {
  const { projects, currentProject, createProject, loadProject, deleteProject } = useAppStore();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateProject = (name: string, description?: string) => {
    createProject(name, description);
  };

  return (
    <div className="h-full p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Projects</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Project</span>
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="bg-gray-50 dark:bg-dark-800 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No projects yet
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Create your first Strudel project to get started with live coding.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              Create Your First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onLoad={loadProject}
                onDelete={deleteProject}
                isActive={currentProject?.id === project.id}
              />
            ))}
          </div>
        )}

        <CreateProjectModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateProject}
        />
      </div>
    </div>
  );
};